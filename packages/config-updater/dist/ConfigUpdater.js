import { EventEmitter } from "node:events";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleRepository } from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
/**
 * Config updater module for handling configuration updates and webhooks
 * Implements the ApplicationModule interface for registration with SharedApplicationServer
 */
export class ConfigUpdater extends EventEmitter {
	cyrusHome;
	paths = new Set([
		"/api/update/cyrus-config",
		"/api/update/cyrus-env",
		"/api/update/repository",
		"/api/test-mcp",
		"/api/configure-mcp",
	]);
	constructor(cyrusHome = process.env.CYRUS_HOME || "~/.cyrusd") {
		super();
		this.cyrusHome = cyrusHome;
		// API key is verified per-request via Authorization header
	}
	/**
	 * Handle incoming requests
	 */
	async handleRequest(req, res, url) {
		try {
			// Verify authentication
			const authHeader = req.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}
			// Read request body
			const body = await this.readBody(req);
			// Route request based on URL
			const pathname = url.pathname;
			let response;
			// Parse JSON body safely
			let parsedBody;
			try {
				parsedBody = JSON.parse(body);
			} catch (error) {
				response = {
					success: false,
					error: "Invalid JSON in request body",
					details: error instanceof Error ? error.message : String(error),
				};
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify(response));
				return;
			}
			if (pathname === "/api/update/cyrus-config" && req.method === "POST") {
				response = await handleCyrusConfig(parsedBody, this.cyrusHome);
				if (response.success) {
					this.emit("configUpdate");
					// Emit restart event if requested
					if (response.data?.restartCyrus) {
						this.emit("restart", "config");
					}
				}
			} else if (
				pathname === "/api/update/cyrus-env" &&
				req.method === "POST"
			) {
				response = await handleCyrusEnv(parsedBody, this.cyrusHome);
				if (response.success && response.data?.restartCyrus) {
					this.emit("restart", "env");
				}
			} else if (
				pathname === "/api/update/repository" &&
				req.method === "POST"
			) {
				response = await handleRepository(parsedBody, this.cyrusHome);
			} else if (pathname === "/api/test-mcp" && req.method === "POST") {
				response = await handleTestMcp(parsedBody);
			} else if (pathname === "/api/configure-mcp" && req.method === "POST") {
				response = await handleConfigureMcp(parsedBody, this.cyrusHome);
			} else {
				response = {
					success: false,
					error: `Unknown endpoint: ${pathname}`,
				};
			}
			// Send response
			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.emit("error", error);
			const response = {
				success: false,
				error: "Internal server error",
				details: error instanceof Error ? error.message : String(error),
			};
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify(response));
		}
	}
	/**
	 * Verify authentication header
	 */
	verifyAuth(authHeader) {
		if (!authHeader) {
			return false;
		}
		const apiKey = process.env.CYRUS_API_KEY;
		if (!apiKey) {
			console.error("CYRUS_API_KEY is not set");
			return false;
		}
		const expectedAuth = `Bearer ${apiKey}`;
		return authHeader === expectedAuth;
	}
	/**
	 * Read request body
	 */
	async readBody(req) {
		return new Promise((resolve, reject) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", () => {
				resolve(body);
			});
			req.on("error", (error) => {
				reject(error);
			});
		});
	}
	/**
	 * Check if a path should be handled by this module
	 */
	shouldHandle(pathname) {
		return this.paths.has(pathname);
	}
}
//# sourceMappingURL=ConfigUpdater.js.map
