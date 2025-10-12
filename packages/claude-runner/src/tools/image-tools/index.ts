import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import fs from "fs-extra";
import OpenAI from "openai";
import { z } from "zod";

/**
 * Options for creating image generation tools
 */
export interface ImageToolsOptions {
	/**
	 * OpenAI API key
	 */
	apiKey: string;

	/**
	 * Directory to save generated images (default: current working directory)
	 */
	outputDirectory?: string;
}

/**
 * Create an SDK MCP server with GPT Image generation tools
 * Uses the Responses API with background mode for async generation
 */
export function createImageToolsServer(options: ImageToolsOptions) {
	const { apiKey, outputDirectory = process.cwd() } = options;

	// Initialize OpenAI client
	const client = new OpenAI({
		apiKey,
		timeout: 600 * 1000, // 10 minutes
	});

	const generateImageTool = tool(
		"gpt_image_generate",
		"Generate an image using GPT Image (gpt-image-1). This starts an async image generation job and returns a job ID. Use gpt_image_check_status to poll for completion, then gpt_image_get to download the image.",
		{
			prompt: z
				.string()
				.describe(
					"Text description of the image you want to generate. Be as detailed as possible for best results.",
				),
			size: z
				.enum(["1024x1024", "1536x1024", "1024x1536", "auto"])
				.optional()
				.default("auto")
				.describe(
					"Image size: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait), or auto (model decides)",
				),
			quality: z
				.enum(["low", "medium", "high", "auto"])
				.optional()
				.default("auto")
				.describe(
					"Image quality: low (fastest), medium, high (best quality), or auto (model decides). Higher quality uses more tokens and takes longer.",
				),
			background: z
				.enum(["transparent", "opaque", "auto"])
				.optional()
				.default("auto")
				.describe(
					"Background type: transparent (PNG/WebP only), opaque, or auto (model decides)",
				),
			output_format: z
				.enum(["png", "jpeg", "webp"])
				.optional()
				.default("png")
				.describe(
					"Output format: png (default, supports transparency), jpeg (faster), or webp (good compression)",
				),
			output_compression: z
				.number()
				.min(0)
				.max(100)
				.optional()
				.describe(
					"Compression level for jpeg/webp (0-100%). Higher = less compression, larger file. Only applicable for jpeg and webp formats.",
				),
		},
		async ({
			prompt,
			size,
			quality,
			background,
			output_format,
			output_compression,
		}) => {
			try {
				console.log(
					`[ImageTools] Starting image generation: ${prompt.substring(0, 50)}... (${size}, ${quality}, ${output_format})`,
				);

				// Validate background transparency is only for PNG/WebP
				if (background === "transparent" && output_format === "jpeg") {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error:
										"Transparent backgrounds are only supported with png or webp formats, not jpeg",
								}),
							},
						],
					};
				}

				// Build tool configuration
				const toolConfig: any = {
					type: "image_generation",
				};

				// Add optional parameters (only if not auto)
				if (size !== "auto") toolConfig.size = size;
				if (quality !== "auto") toolConfig.quality = quality;
				if (background !== "auto") toolConfig.background = background;
				if (output_format) toolConfig.output_format = output_format;
				if (output_compression !== undefined)
					toolConfig.output_compression = output_compression;

				// Use Responses API with background mode for async processing
				const response = await client.responses.create({
					model: "gpt-4o", // Wrapper model that can call image_generation tool
					background: true, // Enable async mode
					store: true, // Store result for retrieval
					tools: [toolConfig],
					input: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				console.log(
					`[ImageTools] Image generation job started: ${response.id}`,
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								jobId: response.id,
								status: response.status,
								message:
									"Image generation job started. Use gpt_image_check_status to poll for completion.",
							}),
						},
					],
				};
			} catch (error) {
				console.error("[ImageTools] Error starting image generation:", error);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const checkStatusTool = tool(
		"gpt_image_check_status",
		"Check the status of a GPT Image generation job. Poll this endpoint until status is 'completed' or 'failed'.",
		{
			jobId: z.string().describe("The job ID returned from gpt_image_generate"),
		},
		async ({ jobId }) => {
			try {
				console.log(`[ImageTools] Checking status for job: ${jobId}`);

				// Retrieve response status from Responses API
				const response = await client.responses.retrieve(jobId);

				console.log(`[ImageTools] Job ${jobId} status: ${response.status}`);

				// Check if completed
				if (response.status === "completed") {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: true,
									jobId: response.id,
									status: response.status,
									message:
										"Image generation complete! Use gpt_image_get to download the image.",
								}),
							},
						],
					};
				}

				// Check if failed
				if (response.status === "failed") {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									jobId: response.id,
									status: response.status,
									error: "Image generation failed",
								}),
							},
						],
					};
				}

				// Still in progress
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								jobId: response.id,
								status: response.status,
								message: `Job is ${response.status}. Continue polling.`,
							}),
						},
					],
				};
			} catch (error) {
				console.error(
					`[ImageTools] Error checking status for job ${jobId}:`,
					error,
				);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const getImageTool = tool(
		"gpt_image_get",
		"Download a completed GPT Image and save it to disk. Returns the local file path.",
		{
			jobId: z
				.string()
				.describe(
					"The job ID from gpt_image_generate (when status is completed)",
				),
			filename: z
				.string()
				.optional()
				.describe(
					"Custom filename for the image (default: generated-{jobId}.png)",
				),
		},
		async ({ jobId, filename }) => {
			try {
				console.log(`[ImageTools] Downloading image for job: ${jobId}`);

				// Retrieve completed response
				// Cast to any since Responses API types may not be fully defined yet
				const response: any = await client.responses.retrieve(jobId);

				if (response.status !== "completed") {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Job is not completed. Current status: ${response.status}`,
								}),
							},
						],
					};
				}

				// Extract image data from output
				const imageGenerationCall = response.output?.find(
					(item: any) => item.type === "image_generation_call",
				);

				if (!imageGenerationCall) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "No image generation data found in response",
								}),
							},
						],
					};
				}

				const base64Data = imageGenerationCall.result;
				const revisedPrompt = imageGenerationCall.revised_prompt;

				if (!base64Data) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "No image data found in response",
								}),
							},
						],
					};
				}

				// Convert base64 to buffer
				const buffer = Buffer.from(base64Data, "base64");

				// Ensure output directory exists
				await fs.ensureDir(outputDirectory);

				// Determine file extension from output_format in response metadata
				const outputFormat =
					imageGenerationCall.output_format ||
					response.metadata?.output_format ||
					"png";
				const ext = outputFormat.toLowerCase();

				// Determine final filename
				const timestamp = Date.now();
				const finalFilename =
					filename || `generated-${jobId.substring(0, 8)}-${timestamp}.${ext}`;
				const filePath = `${outputDirectory}/${finalFilename}`;

				// Write to disk
				await fs.writeFile(filePath, buffer);

				console.log(`[ImageTools] Image saved to: ${filePath}`);
				if (revisedPrompt) {
					console.log(`[ImageTools] Prompt was: ${revisedPrompt}`);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								filePath,
								filename: finalFilename,
								size: buffer.length,
								jobId,
								model: "gpt-image-1",
								revisedPrompt: revisedPrompt || undefined,
								message: `Image downloaded and saved to ${filePath}`,
							}),
						},
					],
				};
			} catch (error) {
				console.error(
					`[ImageTools] Error downloading image for job ${jobId}:`,
					error,
				);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	return createSdkMcpServer({
		name: "image-tools",
		version: "1.0.0",
		tools: [generateImageTool, checkStatusTool, getImageTool],
	});
}
