import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ApiResponse, GitHubCredentialsPayload } from "../types.js";

const execAsync = promisify(exec);

/**
 * Handle GitHub credentials update
 * Updates GitHub CLI authentication with the provided installation token
 */
export async function handleGitHubCredentials(
	payload: GitHubCredentialsPayload,
): Promise<ApiResponse> {
	try {
		// Validate payload
		if (!payload.token || typeof payload.token !== "string") {
			return {
				success: false,
				error: "Invalid payload: token is required",
			};
		}

		// Update GitHub CLI authentication
		try {
			// Run gh auth login with the token via stdin
			const loginCmd = `echo "${payload.token}" | gh auth login --with-token`;
			await execAsync(loginCmd);

			// Setup git to use GitHub CLI credentials
			try {
				await execAsync("gh auth setup-git");
			} catch {
				// Ignore setup-git errors - it's optional
			}

			return {
				success: true,
				message: "GitHub credentials updated successfully",
			};
		} catch (error) {
			return {
				success: false,
				error: "Failed to update GitHub authentication",
				details: error instanceof Error ? error.message : String(error),
			};
		}
	} catch (error) {
		return {
			success: false,
			error: "Failed to process GitHub credentials",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
