import path from "node:path";
import type { Router as RouterType } from "express";
import { type Request, type Response, Router } from "express";
import { handleCyrusConfig } from "../handlers/config-handler";
import {
	handleUpdateCyrusEnv,
	handleUpdateEnvVariables,
} from "../handlers/env-handler";
import { handleGitHubCredentials } from "../handlers/github-handler";
import { handleConfigureMCP, handleTestMCP } from "../handlers/mcp-handler";
import {
	handleCloneRepository,
	handleDeleteRepository,
	handleListRepositories,
} from "../handlers/repository-handler";
import type {
	ConfigureMCPPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	DeleteRepositoryPayload,
	EnvVariablesPayload,
	GitHubCredentialsPayload,
	RepositoryPayload,
	TestMCPPayload,
} from "../types";

export function createConfigRouter(options: {
	cyrusHome: string;
	repositoriesDir: string;
	workspacesDir: string;
	manifestPath: string;
}): RouterType {
	const router = Router();
	const { cyrusHome, repositoriesDir, workspacesDir, manifestPath } = options;

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
	 * POST /api/config/cyrus-env
	 * Update Cyrus environment variables
	 */
	router.post("/cyrus-env", async (req: Request, res: Response) => {
		try {
			const payload: CyrusEnvPayload = req.body;
			const cyrusAppDir = path.dirname(repositoriesDir); // repositories are in cyrus-app/
			await handleUpdateCyrusEnv(payload, cyrusAppDir);
			res.json({
				success: true,
				message: "Cyrus environment variables updated successfully",
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	/**
	 * POST /api/config/env-variables
	 * Update environment variables manifest
	 */
	router.post("/env-variables", async (req: Request, res: Response) => {
		try {
			const payload: EnvVariablesPayload = req.body;
			await handleUpdateEnvVariables(payload, manifestPath);
			res.json({
				success: true,
				message: "Environment variables updated successfully",
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
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

	/**
	 * POST /api/config/mcp
	 * Configure MCP servers
	 */
	router.post("/mcp", async (req: Request, res: Response) => {
		try {
			const payload: ConfigureMCPPayload = req.body;
			const filesWritten = await handleConfigureMCP(payload, cyrusHome);
			res.json({
				success: true,
				message: "MCP servers configured successfully",
				files_written: filesWritten,
			});
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	/**
	 * POST /api/config/test-mcp
	 * Test MCP server connectivity
	 */
	router.post("/test-mcp", async (req: Request, res: Response) => {
		try {
			const payload: TestMCPPayload = req.body;
			const result = await handleTestMCP(payload);
			res.json(result);
		} catch (error) {
			res.status(500).json({
				error: error instanceof Error ? error.message : "Unknown error",
				success: false,
			});
		}
	});

	return router;
}
