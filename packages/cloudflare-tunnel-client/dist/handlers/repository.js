import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
/**
 * Check if a directory contains a git repository
 */
function isGitRepository(path) {
	try {
		return existsSync(join(path, ".git"));
	} catch {
		return false;
	}
}
/**
 * Handle repository cloning or verification
 * - If repository exists at path, verify it's a git repo and do nothing
 * - If repository doesn't exist, clone it to the specified path
 */
export async function handleRepository(payload) {
	try {
		// Validate payload
		if (!payload.path || typeof payload.path !== "string") {
			return {
				success: false,
				error: "Invalid payload: path is required",
			};
		}
		if (!payload.repoUrl || typeof payload.repoUrl !== "string") {
			return {
				success: false,
				error: "Invalid payload: repoUrl is required",
			};
		}
		// Check if repository already exists at the path
		if (existsSync(payload.path)) {
			// Verify it's a git repository
			if (isGitRepository(payload.path)) {
				return {
					success: true,
					message: "Repository already exists at the specified path",
					data: {
						path: payload.path,
						action: "verified",
					},
				};
			}
			return {
				success: false,
				error:
					"Path exists but is not a git repository. Please provide a different path or remove the existing directory.",
				details: `Path: ${payload.path}`,
			};
		}
		// Clone the repository
		try {
			const cloneCmd = `git clone "${payload.repoUrl}" "${payload.path}"`;
			await execAsync(cloneCmd);
			// Verify the clone was successful
			if (!isGitRepository(payload.path)) {
				return {
					success: false,
					error: "Git clone completed but repository verification failed",
					details: `Path: ${payload.path}`,
				};
			}
			return {
				success: true,
				message: "Repository cloned successfully",
				data: {
					path: payload.path,
					repoUrl: payload.repoUrl,
					action: "cloned",
				},
			};
		} catch (error) {
			return {
				success: false,
				error: "Failed to clone repository",
				details: error instanceof Error ? error.message : String(error),
			};
		}
	} catch (error) {
		return {
			success: false,
			error: "Failed to process repository request",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
//# sourceMappingURL=repository.js.map
