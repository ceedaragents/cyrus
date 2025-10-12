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
 */
export function createImageToolsServer(options: ImageToolsOptions) {
	const { apiKey, outputDirectory = process.cwd() } = options;

	// Initialize OpenAI client
	const client = new OpenAI({
		apiKey,
	});

	const generateImageTool = tool(
		"gpt_image_generate",
		"Generate an image using GPT Image (gpt-image-1). This is a synchronous operation that returns the image immediately. The image is automatically saved to disk and the file path is returned. GPT Image provides superior instruction following, text rendering, detailed editing, and real-world knowledge compared to DALL-E.",
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
			filename: z
				.string()
				.optional()
				.describe(
					"Custom filename for the image (default: generated-{timestamp}.{format})",
				),
		},
		async ({
			prompt,
			size,
			quality,
			background,
			output_format,
			output_compression,
			filename,
		}) => {
			try {
				console.log(
					`Generating image with gpt-image-1: ${prompt.substring(0, 50)}... (${size}, ${quality}, ${output_format})`,
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

				// Build request parameters - gpt-image-1 returns base64 by default
				const requestParams: any = {
					model: "gpt-image-1",
					prompt,
					n: 1,
				};

				// Add optional parameters (only if not auto)
				if (size !== "auto") requestParams.size = size;
				if (quality !== "auto") requestParams.quality = quality;
				if (background !== "auto") requestParams.background = background;
				if (output_format) requestParams.output_format = output_format;
				if (output_compression !== undefined)
					requestParams.output_compression = output_compression;

				// Generate image using OpenAI SDK
				const response = await client.images.generate(requestParams);

				if (!response.data || response.data.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "No image data returned from OpenAI API",
								}),
							},
						],
					};
				}

				const image = response.data[0];
				if (!image || !image.b64_json) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: "Invalid image data returned from OpenAI API",
								}),
							},
						],
					};
				}

				const base64Data = image.b64_json;
				const revisedPrompt = image.revised_prompt;

				// Convert base64 to buffer
				const buffer = Buffer.from(base64Data, "base64");

				// Ensure output directory exists
				await fs.ensureDir(outputDirectory);

				// Determine file extension based on format
				const ext = output_format || "png";

				// Determine final filename
				const timestamp = Date.now();
				const finalFilename = filename || `generated-${timestamp}.${ext}`;
				const filePath = `${outputDirectory}/${finalFilename}`;

				// Write to disk
				await fs.writeFile(filePath, buffer);

				console.log(`Image saved to: ${filePath}`);
				if (revisedPrompt && revisedPrompt !== prompt) {
					console.log(`Prompt enhanced to: ${revisedPrompt}`);
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
								model: "gpt-image-1",
								resolution: size,
								quality,
								background,
								format: output_format,
								compression: output_compression,
								originalPrompt: prompt,
								revisedPrompt: revisedPrompt || prompt,
								message: `Image generated and saved to ${filePath}`,
							}),
						},
					],
				};
			} catch (error) {
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
		tools: [generateImageTool],
	});
}
