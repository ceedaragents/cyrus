import { execFileSync } from "node:child_process";

/**
 * Ensure a path is owned by the cyrus user when the process is running as root.
 * Prevents directories created by a root process from blocking the cyrus user.
 */
export function ensureCyrusOwnership(path: string): void {
	if (process.getuid?.() !== 0) return;
	try {
		execFileSync("chown", ["-R", "cyrus:cyrus", path], { stdio: "ignore" });
	} catch {
		// Best-effort ownership fix
	}
}
