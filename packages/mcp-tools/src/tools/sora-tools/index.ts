import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs-extra";
import type OpenAI from "openai";
import { toFile } from "openai";
import { z } from "zod";

/**
 * Get MIME type from filename
 * Sora only supports: image/jpeg, image/png, image/webp
 */
function getMimeType(filename: string): string | null {
	const ext = filename.toLowerCase();
	if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (ext.endsWith(".png")) {
		return "image/png";
	}
	if (ext.endsWith(".webp")) {
		return "image/webp";
	}
	return null;
}

/**
 * Register Sora video generation tools on the given MCP server.
 */
export function registerSoraTools(
	server: McpServer,
	client: OpenAI,
	outputDirectory: string,
): void {
	server.registerTool(
		"sora_generate_video",
		{
			description:
				"Generate a video using Sora 2. Supports text-to-video and image-to-video generation. For image-to-video, the reference image must match the target video resolution (width x height). Returns a job ID to poll for completion.",
			inputSchema: {
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
				size: z
					.enum(["720x1280", "1280x720", "1024x1792", "1792x1024"])
					.optional()
					.default("1280x720")
					.describe(
						"Output resolution. Options: 720x1280 (portrait), 1280x720 (landscape), 1024x1792 (tall portrait), 1792x1024 (wide landscape)",
					),
				seconds: z
					.enum(["4", "8", "12"])
					.optional()
					.default("4")
					.describe("Video duration in seconds: 4, 8, or 12"),
				input_reference: z
					.string()
					.optional()
					.describe(
						"Path to reference image file for image-to-video generation. Supported formats: JPEG, PNG, WebP only. IMPORTANT: The image must match the target video's resolution (size parameter).",
					),
			},
		},
		async ({ prompt, model, size, seconds, input_reference }) => {
			try {
				console.log(
					`Starting video generation: ${prompt.substring(0, 50)}... (${size}, ${seconds}s, ${model})${input_reference ? ` with reference: ${input_reference}` : ""}`,
				);

				// Build the request parameters
				const videoParams: OpenAI.VideoCreateParams = {
					model,
					prompt,
					size,
					seconds,
				};

				// Add input_reference if provided
				if (input_reference) {
					// Validate file exists
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

					// Get MIME type for the file
					const mimeType = getMimeType(filename);
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

					// Use toFile helper to create a proper File object with MIME type
					videoParams.input_reference = await toFile(
						fs.createReadStream(input_reference),
						filename,
						{ type: mimeType },
					);

					console.log(`Uploading reference file: ${filename} (${mimeType})`);
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

	server.registerTool(
		"sora_check_status",
		{
			description:
				"Check the status of a Sora video generation job. Poll this endpoint until status is 'completed' or 'failed'.",
			inputSchema: {
				jobId: z
					.string()
					.describe("The job ID returned from sora_generate_video"),
			},
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
								progress: video.progress,
								message:
									video.status === "completed"
										? "Video generation complete! Use sora_get_video to download the video."
										: video.status === "failed"
											? `Video generation failed: ${video.error?.message || "Unknown error"}`
											: `Job is ${video.status}. Progress: ${video.progress}%. Continue polling.`,
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

	server.registerTool(
		"sora_get_video",
		{
			description:
				"Download a completed Sora video and save it to disk. Returns the local file path.",
			inputSchema: {
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
}
