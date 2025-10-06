import { basename } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import fs from "fs-extra";
import OpenAI from "openai";
import { z } from "zod";

/**
 * Options for creating Sora tools
 */
export interface SoraToolsOptions {
	/**
	 * Azure OpenAI endpoint (e.g., "https://your-resource.openai.azure.com")
	 */
	endpoint: string;

	/**
	 * Azure OpenAI API key
	 */
	apiKey: string;

	/**
	 * Directory to save generated videos (default: current working directory)
	 */
	outputDirectory?: string;
}

/**
 * Detect MIME type based on file extension
 * Sora only supports: image/jpeg, image/png, image/webp
 */
function getMediaMimeType(filename: string): string | null {
	const ext = filename.toLowerCase();
	if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
	if (ext.endsWith(".png")) return "image/png";
	if (ext.endsWith(".webp")) return "image/webp";
	return null; // Unsupported format
}

/**
 * Create an SDK MCP server with Sora video generation tools
 */
export function createSoraToolsServer(options: SoraToolsOptions) {
	const { endpoint, apiKey, outputDirectory = process.cwd() } = options;

	// Initialize OpenAI client configured for Azure
	const client = new OpenAI({
		apiKey,
		baseURL: `${endpoint}/openai`,
		defaultQuery: { "api-version": "preview" },
	});

	const generateVideoTool = tool(
		"sora_generate_video",
		"Generate a video using Sora 2. Supports text-to-video and image-to-video generation. For image-to-video, the reference image must match the target video resolution (width x height). Returns a job ID to poll for completion.",
		{
			prompt: z
				.string()
				.describe("Text description of the video you want to generate"),
			model: z
				.enum(["sora-2", "sora-2-pro"])
				.optional()
				.default("sora-2")
				.describe(
					"Model to use: sora-2 (faster, good quality) or sora-2-pro (slower, higher quality)",
				),
			width: z
				.number()
				.optional()
				.default(1920)
				.describe("Video width in pixels (default: 1920)"),
			height: z
				.number()
				.optional()
				.default(1080)
				.describe("Video height in pixels (default: 1080)"),
			seconds: z
				.number()
				.optional()
				.default(5)
				.describe("Video duration in seconds (default: 5)"),
			input_reference: z
				.string()
				.optional()
				.describe(
					"Path to reference image file for image-to-video generation. Supported formats: JPEG, PNG, WebP only. IMPORTANT: The image must match the target video's resolution (width x height parameters).",
				),
		},
		async ({ prompt, model, width, height, seconds, input_reference }) => {
			try {
				console.log(
					`Starting video generation: ${prompt.substring(0, 50)}... (${width}x${height}, ${seconds}s, ${model})${input_reference ? ` with reference: ${input_reference}` : ""}`,
				);

				// Build the request parameters
				const videoParams: any = {
					model,
					prompt,
					size: `${width}x${height}`,
					seconds: seconds.toString(),
				};

				// Add input_reference if provided
				if (input_reference) {
					// Read and validate the reference file
					if (!(await fs.pathExists(input_reference))) {
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										success: false,
										error: `Reference file not found: ${input_reference}`,
									}),
								},
							],
						};
					}

					const filename = basename(input_reference);
					const mimeType = getMediaMimeType(input_reference);

					// Validate file format
					if (!mimeType) {
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										success: false,
										error: `Unsupported file format. Only JPEG, PNG, and WebP images are supported. File: ${filename}`,
									}),
								},
							],
						};
					}

					// Read file as buffer and create File object for OpenAI SDK
					const fileBuffer = await fs.readFile(input_reference);
					const fileObject = new File([fileBuffer], filename, {
						type: mimeType,
					});

					videoParams.input_reference = fileObject;

					console.log(
						`Uploading reference file: ${filename} (${mimeType}, ${fileBuffer.length} bytes)`,
					);
				}

				// Use OpenAI SDK's videos.create method
				const video = await client.videos.create(videoParams);

				console.log(`Video generation job started: ${video.id}`);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								jobId: video.id,
								status: video.status,
								message:
									"Video generation job started. Use sora_check_status to poll for completion.",
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

	const checkStatusTool = tool(
		"sora_check_status",
		"Check the status of a Sora video generation job. Poll this endpoint until status is 'succeeded' or 'failed'.",
		{
			jobId: z
				.string()
				.describe("The job ID returned from sora_generate_video"),
		},
		async ({ jobId }) => {
			try {
				console.log(`Checking status for job: ${jobId}`);

				// Use OpenAI SDK's videos.retrieve method
				const video = await client.videos.retrieve(jobId);

				console.log(`Job ${jobId} status: ${video.status}`);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								jobId: video.id,
								status: video.status,
								progress: video.progress ?? 0,
								message:
									video.status === "completed"
										? "Video generation complete! Use sora_get_video to download the video."
										: video.status === "failed"
											? "Video generation failed."
											: `Job is ${video.status}. Continue polling.`,
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

	const getVideoTool = tool(
		"sora_get_video",
		"Download a completed Sora video and save it to disk. Returns the local file path.",
		{
			jobId: z
				.string()
				.describe(
					"The job ID from sora_generate_video (when status is completed)",
				),
			filename: z
				.string()
				.optional()
				.describe(
					"Custom filename for the video (default: generated-{jobId}.mp4)",
				),
			variant: z
				.enum(["video", "thumbnail", "spritesheet"])
				.optional()
				.default("video")
				.describe(
					"What to download: video (MP4), thumbnail (WebP), or spritesheet (JPG)",
				),
		},
		async ({ jobId, filename, variant }) => {
			try {
				console.log(`Downloading ${variant} for job: ${jobId}`);

				// Use OpenAI SDK's videos.downloadContent method
				const content = await client.videos.downloadContent(jobId, {
					variant,
				});

				// Get the file extension based on variant
				const ext =
					variant === "video"
						? "mp4"
						: variant === "thumbnail"
							? "webp"
							: "jpg";

				// Convert the response to buffer
				const arrayBuffer = await content.arrayBuffer();
				const buffer = Buffer.from(arrayBuffer);

				// Ensure output directory exists
				await fs.ensureDir(outputDirectory);

				// Determine final filename
				const finalFilename =
					filename || `generated-${jobId.substring(0, 8)}.${ext}`;
				const filePath = `${outputDirectory}/${finalFilename}`;

				// Write to disk
				await fs.writeFile(filePath, buffer);

				console.log(`${variant} saved to: ${filePath}`);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								filePath,
								filename: finalFilename,
								size: buffer.length,
								variant,
								message: `${variant} downloaded and saved to ${filePath}`,
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
		name: "sora-tools",
		version: "1.0.0",
		tools: [generateVideoTool, checkStatusTool, getVideoTool],
	});
}
