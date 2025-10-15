import path from "node:path";
import type { Router as RouterType } from "express";
import { type Request, type Response, Router } from "express";
import { handleCyrusConfig } from "../handlers/config-handler";
import { handleGitHubCredentials } from "../handlers/github-handler";
import {
	handleCloneRepository,
	handleDeleteRepository,
	handleListRepositories,
} from "../handlers/repository-handler";
import type {
	CyrusConfigPayload,
	DeleteRepositoryPayload,
	GitHubCredentialsPayload,
	RepositoryPayload,
} from "../types";

export function createConfigRouter(options: {
	cyrusHome: string;
	repositoriesDir: string;
	workspacesDir: string;
}): RouterType {
	const router = Router();
	const { cyrusHome, repositoriesDir, workspacesDir } = options;

	/**
	 * POST /api/config/github
	 * Update GitHub credentials
	 */
	router.post("/github", async (req: Request, res: Response) => {
		try {
			const payload: GitHubCredentialsPayload = req.body;
			await handleGitHubCredentials(payload);
			res.json({
				success: true,
				message: "GitHub credentials updated successfully",
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	/**
	 * POST /api/config/cyrus-config
	 * Update main Cyrus configuration
	 */
	router.post("/cyrus-config", async (req: Request, res: Response) => {
		try {
			const payload: CyrusConfigPayload = req.body;
			await handleCyrusConfig(payload, cyrusHome);
			res.json({
				success: true,
				message: "Cyrus configuration updated successfully",
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	/**
	 * GET /api/cyrus-config
	 * Retrieve current Cyrus configuration
	 */
	router.get("/cyrus-config", async (_req: Request, res: Response) => {
		try {
			const fs = await import("node:fs/promises");
			const configPath = path.join(cyrusHome, "config.json");
			const content = await fs.readFile(configPath, "utf-8");
			res.json(JSON.parse(content));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				res.status(404).json({ error: "Configuration file not found" });
			} else {
				res.status(500).json({
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	});

	/**
	 * POST /api/config/repository
	 * Clone a repository
	 */
	router.post("/repository", async (req: Request, res: Response) => {
		try {
			const payload: RepositoryPayload = req.body;
			const clonedPath = await handleCloneRepository(payload, repositoriesDir);
			res.json({
				success: true,
				message: "Repository cloned successfully",
				path: clonedPath,
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	/**
	 * DELETE /api/config/repository
	 * Delete a repository and its worktrees
	 */
	router.delete("/repository", async (req: Request, res: Response) => {
		try {
			const payload: DeleteRepositoryPayload = req.body;
			const deletedPaths = await handleDeleteRepository(
				payload,
				repositoriesDir,
				workspacesDir,
			);
			res.json({
				success: true,
				message: "Repository deleted successfully",
				deleted_paths: deletedPaths,
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	/**
	 * GET /api/repositories
	 * List all repositories
	 */
	router.get("/repositories", async (_req: Request, res: Response) => {
		try {
			const repositories = await handleListRepositories(repositoriesDir);
			res.json(repositories);
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	return router;
}
