import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * GET /api/admin/gh-status — check GitHub CLI auth status
 */
export function handleGetGhStatus() {
	return async () => {
		let isInstalled = false;
		let isAuthenticated = false;
		let statusOutput = "";

		try {
			await execAsync("gh --version");
			isInstalled = true;
		} catch {
			return {
				success: true,
				data: { isInstalled: false, isAuthenticated: false, statusOutput: "" },
			};
		}

		try {
			const { stdout, stderr } = await execAsync("gh auth status 2>&1");
			isAuthenticated = true;
			statusOutput = stdout || stderr;
		} catch (error: unknown) {
			// gh auth status exits non-zero when not authenticated
			const execError = error as {
				stderr?: string;
				stdout?: string;
			} | null;
			statusOutput = String(execError?.stderr || execError?.stdout || "");
		}

		return {
			success: true,
			data: { isInstalled, isAuthenticated, statusOutput },
		};
	};
}
