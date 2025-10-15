import path from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { createAuthMiddleware } from "./middleware/auth";
import { loggingMiddleware } from "./middleware/logging";
import { createConfigRouter } from "./routes/config";
import healthRouter from "./routes/health";
import type { ConfigServerOptions } from "./types";

export class ConfigServer {
	private app: Express;
	private server?: ReturnType<typeof import("http").createServer>;
	private options: ConfigServerOptions;

	constructor(options: ConfigServerOptions) {
		this.options = options;
		this.app = express();
		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// Security middleware
		this.app.use(helmet());
		this.app.use(cors());

		// Body parsing
		this.app.use(express.json());
		this.app.use(express.urlencoded({ extended: true }));

		// Logging
		this.app.use(loggingMiddleware);
	}

	private setupRoutes(): void {
		const { secret, cyrusHome, workspacesDir, repositoriesDir } = this.options;

		// Derive paths
		const actualWorkspacesDir =
			workspacesDir || path.join(path.dirname(cyrusHome), "cyrus-workspaces");
		const actualRepositoriesDir =
			repositoriesDir || path.join(path.dirname(cyrusHome), "cyrus-app");

		// Public routes (no auth required)
		this.app.use("/", healthRouter);

		// Protected routes (auth required)
		const authMiddleware = createAuthMiddleware(secret);
		const configRouter = createConfigRouter({
			cyrusHome,
			repositoriesDir: actualRepositoriesDir,
			workspacesDir: actualWorkspacesDir,
		});

		this.app.use("/api/config", authMiddleware, configRouter);

		// 404 handler
		this.app.use((_req, res) => {
			res.status(404).json({ error: "Not found" });
		});

		// Error handler
		this.app.use(
			(
				err: Error,
				_req: express.Request,
				res: express.Response,
				_next: express.NextFunction,
			) => {
				console.error("Server error:", err);
				res.status(500).json({
					error: "Internal server error",
					message: err.message,
				});
			},
		);
	}

	/**
	 * Start the config server
	 */
	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.server = this.app.listen(this.options.port, () => {
					console.log(`Config server listening on port ${this.options.port}`);

					if (this.options.onConfigUpdate) {
						console.log("Config update callback registered");
					}

					resolve();
				});

				this.server.on("error", (error) => {
					reject(error);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Stop the config server
	 */
	async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.server) {
				resolve();
				return;
			}

			this.server.close((err) => {
				if (err) {
					reject(err);
				} else {
					console.log("Config server stopped");
					resolve();
				}
			});
		});
	}

	/**
	 * Get the Express app instance (for testing)
	 */
	getApp(): Express {
		return this.app;
	}

	/**
	 * Check if server is running
	 */
	isRunning(): boolean {
		return this.server?.listening ?? false;
	}
}
