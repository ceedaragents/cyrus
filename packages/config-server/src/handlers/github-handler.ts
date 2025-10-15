import { spawn } from "node:child_process";
import type { GitHubCredentialsPayload } from "../types";

/**
 * Executes a command using child_process.spawn
 * @param command - The command to execute
 * @param args - Array of command arguments
 * @param stdin - Optional stdin data to pipe to the command
 * @returns Promise that resolves with stdout or rejects with stderr
 */
async function executeCommand(
	command: string,
	args: string[],
	stdin?: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args);

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to execute ${command}: ${error.message}`));
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`${command} failed: ${stderr || stdout}`));
			} else {
				resolve(stdout);
			}
		});

		// If stdin is provided, write it to the process
		if (stdin !== undefined) {
			proc.stdin.write(stdin);
			proc.stdin.end();
		}
	});
}

/**
 * Handles GitHub credentials configuration
 * Authenticates with GitHub CLI using the provided token and sets up git credentials
 *
 * @param payload - The GitHub credentials payload containing the token
 * @throws Error if token is missing or authentication fails
 */
export async function handleGitHubCredentials(
	payload: GitHubCredentialsPayload,
): Promise<void> {
	// Validate that token is provided
	if (!payload.token || payload.token.trim() === "") {
		throw new Error("Token is required");
	}

	try {
		// Run gh auth login with the token passed via stdin
		await executeCommand(
			"gh",
			["auth", "login", "--with-token"],
			payload.token,
		);

		console.log("GitHub authentication updated successfully");

		// Also setup git to use the GitHub CLI credentials
		// This is optional - we log warnings but don't fail if it doesn't work
		try {
			await executeCommand("gh", ["auth", "setup-git"]);
			console.log("Git credentials configured successfully");
		} catch (setupError) {
			// Log the error but don't fail - git setup is optional
			console.warn(
				`Warning: gh auth setup-git failed: ${setupError instanceof Error ? setupError.message : String(setupError)}`,
			);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to update GitHub authentication: ${errorMessage}`);
	}
}
