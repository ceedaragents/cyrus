import { basename } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import fs from "fs-extra";
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

	const generateVideoTool = tool(
		"sora_generate_video",
		"Generate a video using Sora 2. Supports text-to-video and image-to-video generation. For image-to-video, the reference image must match the target video resolution (width x height). Returns a job ID to poll for completion.",
		{
			prompt: z
				.string()
				.describe("Text description of the video you want to generate"),
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
			n_seconds: z
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
		async ({ prompt, width, height, n_seconds, input_reference }) => {
			try {
				console.log(
					`Starting video generation: ${prompt.substring(0, 50)}... (${width}x${height}, ${n_seconds}s)${input_reference ? ` with reference: ${input_reference}` : ""}`,
				);

				const url = `${endpoint}/openai/v1/video/generations/jobs?api-version=preview`;

				// Build the request - use multipart/form-data if we have input_reference
				let response: Response;

				if (input_reference) {
					// Read the reference file
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

					const fileBuffer = await fs.readFile(input_reference);
					const mimeType = getMediaMimeType(input_reference);
					const filename = basename(input_reference);

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

					// Create multipart form data
					const formData = new FormData();
					formData.append("model", "sora");
					formData.append("prompt", prompt);
					formData.append("width", width.toString());
					formData.append("height", height.toString());
					formData.append("n_seconds", n_seconds.toString());

					// Add the reference file with proper MIME type
					const blob = new Blob([fileBuffer], { type: mimeType });
					formData.append("input_reference", blob, filename);

					console.log(
						`Uploading reference file: ${filename} (${mimeType}, ${fileBuffer.length} bytes)`,
					);

					response = await fetch(url, {
						method: "POST",
						headers: {
							"api-key": apiKey,
							// Don't set Content-Type - let fetch set it with boundary
						},
						body: formData,
					});
				} else {
					// JSON request for text-to-video
					const requestBody = {
						model: "sora",
						prompt,
						width,
						height,
						n_seconds,
					};

					response = await fetch(url, {
						method: "POST",
						headers: {
							"api-key": apiKey,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(requestBody),
					});
				}

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Failed to start video generation: ${response.status} ${response.statusText} - ${errorText}`,
								}),
							},
						],
					};
				}

				const result = (await response.json()) as {
					id: string;
					status: string;
				};

				console.log(`Video generation job started: ${result.id}`);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								jobId: result.id,
								status: result.status,
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

				const url = `${endpoint}/openai/v1/video/generations/jobs/${jobId}?api-version=preview`;

				const response = await fetch(url, {
					method: "GET",
					headers: {
						"api-key": apiKey,
					},
				});

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Failed to check job status: ${response.status} ${response.statusText} - ${errorText}`,
								}),
							},
						],
					};
				}

				const result = (await response.json()) as {
					id: string;
					status: string;
					generations?: Array<{ id: string }>;
				};

				console.log(`Job ${jobId} status: ${result.status}`);

				// Include generation_id if available (needed for retrieving the video)
				const responseData: {
					success: boolean;
					jobId: string;
					status: string;
					generationId?: string;
					message: string;
				} = {
					success: true,
					jobId: result.id,
					status: result.status,
					message: "",
				};

				// Check if we have generations in the response
				if (result.generations && result.generations.length > 0) {
					responseData.generationId = result.generations[0]?.id;
					responseData.message =
						result.status === "succeeded"
							? "Video generation complete! Use sora_get_video to download the video."
							: `Job is ${result.status}. Continue polling if not complete.`;
				} else {
					responseData.message = `Job is ${result.status}. ${result.status === "succeeded" ? "Waiting for generation ID..." : "Continue polling."}`;
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(responseData),
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
			generationId: z
				.string()
				.describe(
					"The generation ID from sora_check_status when status is 'succeeded'",
				),
			filename: z
				.string()
				.optional()
				.describe(
					"Custom filename for the video (default: generated-{generationId}.mp4)",
				),
		},
		async ({ generationId, filename }) => {
			try {
				console.log(`Downloading video for generation: ${generationId}`);

				const url = `${endpoint}/openai/v1/video/generations/${generationId}/content/video?api-version=preview`;

				const response = await fetch(url, {
					method: "GET",
					headers: {
						"api-key": apiKey,
					},
				});

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Failed to download video: ${response.status} ${response.statusText} - ${errorText}`,
								}),
							},
						],
					};
				}

				// Get video data as buffer
				const videoBuffer = Buffer.from(await response.arrayBuffer());

				// Ensure output directory exists
				await fs.ensureDir(outputDirectory);

				// Determine final filename
				const finalFilename =
					filename || `generated-${generationId.substring(0, 8)}.mp4`;
				const filePath = `${outputDirectory}/${finalFilename}`;

				// Write video to disk
				await fs.writeFile(filePath, videoBuffer);

				console.log(`Video saved to: ${filePath}`);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								filePath,
								filename: finalFilename,
								size: videoBuffer.length,
								message: `Video downloaded and saved to ${filePath}`,
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
