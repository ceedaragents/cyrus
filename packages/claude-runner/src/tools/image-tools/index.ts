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
 * Create an SDK MCP server with DALL-E image generation tools
 */
export function createImageToolsServer(options: ImageToolsOptions) {
	const { apiKey, outputDirectory = process.cwd() } = options;

	// Initialize OpenAI client
	const client = new OpenAI({
		apiKey,
	});

	const generateImageTool = tool(
		"dalle_generate_image",
		"Generate an image using DALL-E 3. This is a synchronous operation that returns the image immediately. The image is automatically saved to disk and the file path is returned.",
		{
			prompt: z
				.string()
				.max(4000)
				.describe(
					"Text description of the image you want to generate (max 4000 characters). DALL-E 3 will automatically enhance your prompt for better results.",
				),
			model: z
				.enum(["dall-e-2", "dall-e-3"])
				.optional()
				.default("dall-e-3")
				.describe(
					"Model to use: dall-e-2 (faster, lower quality) or dall-e-3 (recommended, higher quality)",
				),
			size: z
				.enum(["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"])
				.optional()
				.default("1024x1024")
				.describe(
					"Image size. DALL-E 2: 256x256, 512x512, 1024x1024. DALL-E 3: 1024x1024 (square), 1792x1024 (landscape), 1024x1792 (portrait)",
				),
			quality: z
				.enum(["standard", "hd"])
				.optional()
				.default("standard")
				.describe(
					"Image quality (DALL-E 3 only). 'standard' is faster and cheaper, 'hd' provides higher quality with finer details",
				),
			style: z
				.enum(["vivid", "natural"])
				.optional()
				.default("vivid")
				.describe(
					"Image style (DALL-E 3 only). 'vivid' creates hyper-real and dramatic images, 'natural' creates more natural, less hyper-real images",
				),
			filename: z
				.string()
				.optional()
				.describe(
					"Custom filename for the image (default: generated-{timestamp}.png)",
				),
		},
		async ({ prompt, model, size, quality, style, filename }) => {
			try {
				console.log(
					`Generating image with ${model}: ${prompt.substring(0, 50)}... (${size}, ${quality})`,
				);

				// Validate size for the selected model
				if (model === "dall-e-2") {
					if (!["256x256", "512x512", "1024x1024"].includes(size)) {
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										success: false,
										error: `Invalid size for DALL-E 2. Supported sizes: 256x256, 512x512, 1024x1024. Got: ${size}`,
									}),
								},
							],
						};
					}
				} else if (model === "dall-e-3") {
					if (!["1024x1024", "1792x1024", "1024x1792"].includes(size)) {
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										success: false,
										error: `Invalid size for DALL-E 3. Supported sizes: 1024x1024, 1792x1024, 1024x1792. Got: ${size}`,
									}),
								},
							],
						};
					}
				}

				// Generate image using OpenAI SDK
				const response = await client.images.generate({
					model,
					prompt,
					n: 1, // DALL-E 3 only supports n=1
					size,
					quality: model === "dall-e-3" ? quality : undefined,
					style: model === "dall-e-3" ? style : undefined,
					response_format: "b64_json", // Use base64 for permanent storage
				});

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

				// Determine final filename
				const timestamp = Date.now();
				const finalFilename = filename || `generated-${timestamp}.png`;
				const filePath = `${outputDirectory}/${finalFilename}`;

				// Write to disk
				await fs.writeFile(filePath, buffer);

				console.log(`Image saved to: ${filePath}`);
				if (revisedPrompt && revisedPrompt !== prompt) {
					console.log(`Prompt enhanced by DALL-E 3 to: ${revisedPrompt}`);
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
								model,
								resolution: size,
								quality,
								style,
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
