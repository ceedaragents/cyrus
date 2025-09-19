#!/usr/bin/env node

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import readline from "node:readline";
import type { Issue } from "@linear/sdk";
import { DEFAULT_PROXY_URL } from "cyrus-core";
import {
	EdgeWorker,
	type EdgeWorkerConfig,
	type RepositoryConfig,
	SharedApplicationServer,
} from "cyrus-edge-worker";
import dotenv from "dotenv";
import open from "open";

// Parse command line arguments
const args = process.argv.slice(2);
const envFileArg = args.find((arg) => arg.startsWith("--env-file="));
const cyrusHomeArg = args.find((arg) => arg.startsWith("--cyrus-home="));

// Constants are imported from cyrus-core

// Determine the Cyrus home directory once at startup
let CYRUS_HOME: string;
if (cyrusHomeArg) {
	const customPath = cyrusHomeArg.split("=")[1];
	if (customPath) {
		CYRUS_HOME = resolve(customPath);
	} else {
		console.error("Error: --cyrus-home flag requires a directory path");
		process.exit(1);
	}
} else {
	CYRUS_HOME = resolve(homedir(), ".cyrus");
}

// Note: __dirname removed since version is now hardcoded

// Handle --version argument
if (args.includes("--version")) {
	console.log("0.1.37");
	process.exit(0);
}

// Handle --help argument
if (args.includes("--help") || args.includes("-h")) {
	console.log(`
cyrus - AI-powered Linear issue automation using Claude

Usage: cyrus [command] [options]

Commands:
  start              Start the edge worker (default)
  check-tokens       Check the status of all Linear tokens
  refresh-token      Refresh a specific Linear token
  add-repository     Add a new repository configuration
  billing            Open Stripe billing portal (Pro plan only)
  set-customer-id    Set your Stripe customer ID

Options:
  --version          Show version number
  --help, -h         Show help
  --env-file=<path>  Load environment variables from file
  --cyrus-home=<dir> Specify custom Cyrus config directory (default: ~/.cyrus)

Examples:
  cyrus                          Start the edge worker
  cyrus check-tokens             Check all Linear token statuses
  cyrus refresh-token            Interactive token refresh
  cyrus add-repository           Add a new repository interactively
  cyrus --cyrus-home=/tmp/cyrus  Use custom config directory
`);
	process.exit(0);
}

// Load environment variables only if --env-file is specified
if (envFileArg) {
	const envFile = envFileArg.split("=")[1];
	if (envFile) {
		dotenv.config({ path: envFile });
	}
}

interface LinearCredentials {
	linearToken: string;
	linearWorkspaceId: string;
	linearWorkspaceName: string;
}

interface EdgeConfig {
	repositories: RepositoryConfig[];
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	defaultModel?: string; // Default Claude model to use across all repositories
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable
}

interface Workspace {
	path: string;
	isGitWorktree: boolean;
}

/**
 * Edge application that uses EdgeWorker from package
 */
class EdgeApp {
	private edgeWorker: EdgeWorker | null = null;
	private isShuttingDown = false;
	private cyrusHome: string;

	constructor(cyrusHome: string) {
		this.cyrusHome = cyrusHome;
	}

	/**
	 * Get the edge configuration file path
	 */
	getEdgeConfigPath(): string {
		return resolve(this.cyrusHome, "config.json");
	}

	/**
	 * Get the legacy edge configuration file path (for migration)
	 */
	getLegacyEdgeConfigPath(): string {
		return resolve(process.cwd(), ".edge-config.json");
	}

	/**
	 * Migrate configuration from legacy location if needed
	 */
	private migrateConfigIfNeeded(): void {
		const newConfigPath = this.getEdgeConfigPath();
		const legacyConfigPath = this.getLegacyEdgeConfigPath();

		// If new config already exists, no migration needed
		if (existsSync(newConfigPath)) {
			return;
		}

		// If legacy config doesn't exist, no migration needed
		if (!existsSync(legacyConfigPath)) {
			return;
		}

		try {
			// Ensure the ~/.cyrus directory exists
			const configDir = dirname(newConfigPath);
			if (!existsSync(configDir)) {
				mkdirSync(configDir, { recursive: true });
			}

			// Copy the legacy config to the new location
			copyFileSync(legacyConfigPath, newConfigPath);

			console.log(
				`📦 Migrated configuration from ${legacyConfigPath} to ${newConfigPath}`,
			);
			console.log(
				`💡 You can safely remove the old ${legacyConfigPath} file if desired`,
			);
		} catch (error) {
			console.warn(
				`⚠️  Failed to migrate config from ${legacyConfigPath}:`,
				(error as Error).message,
			);
			console.warn(
				`   Please manually copy your configuration to ${newConfigPath}`,
			);
		}
	}

	/**
	 * Load edge configuration (credentials and repositories)
	 * Note: Strips promptTemplatePath from all repositories to ensure built-in template is used
	 */
	loadEdgeConfig(): EdgeConfig {
		// Migrate from legacy location if needed
		this.migrateConfigIfNeeded();

		const edgeConfigPath = this.getEdgeConfigPath();
		let config: EdgeConfig = { repositories: [] };

		if (existsSync(edgeConfigPath)) {
			try {
				config = JSON.parse(readFileSync(edgeConfigPath, "utf-8"));
			} catch (e) {
				console.error("Failed to load edge config:", (e as Error).message);
			}
		}

		// Strip promptTemplatePath from all repositories to ensure built-in template is used
		if (config.repositories) {
			config.repositories = config.repositories.map((repo) => {
				const { promptTemplatePath, ...repoWithoutTemplate } = repo;
				if (promptTemplatePath) {
					console.log(
						`Ignoring custom prompt template for repository: ${repo.name} (using built-in template)`,
					);
				}
				return repoWithoutTemplate;
			});
		}

		return config;
	}

	/**
	 * Save edge configuration
	 */
	saveEdgeConfig(config: EdgeConfig): void {
		const edgeConfigPath = this.getEdgeConfigPath();
		const configDir = dirname(edgeConfigPath);

		// Ensure the ~/.cyrus directory exists
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}

		writeFileSync(edgeConfigPath, JSON.stringify(config, null, 2));
	}

	/**
	 * Interactive setup wizard for repository configuration
	 */
	async setupRepositoryWizard(
		linearCredentials: LinearCredentials,
		rl?: readline.Interface,
	): Promise<RepositoryConfig> {
		const shouldCloseRl = !rl;
		if (!rl) {
			rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
		}

		const question = (prompt: string): Promise<string> =>
			new Promise((resolve) => {
				rl.question(prompt, resolve);
			});

		console.log("\n📁 Repository Setup");
		console.log("─".repeat(50));

		try {
			// Ask for repository details
			const repositoryPath =
				(await question(`Repository path (default: ${process.cwd()}): `)) ||
				process.cwd();
			const repositoryName =
				(await question(
					`Repository name (default: ${basename(repositoryPath)}): `,
				)) || basename(repositoryPath);
			const baseBranch =
				(await question("Base branch (default: main): ")) || "main";
			// Create a path-safe version of the repository name for namespacing
			const repoNameSafe = repositoryName
				.replace(/[^a-zA-Z0-9-_]/g, "-")
				.toLowerCase();
			const workspaceBaseDir = resolve(
				this.cyrusHome,
				"workspaces",
				repoNameSafe,
			);

			// Note: Prompt template is now hardcoded - no longer configurable

			// Set reasonable defaults for configuration
			// Allowed tools - default to all tools except Bash, plus Bash(git:*) and Bash(gh:*)
			// Note: MCP tools (mcp__linear, mcp__cyrus-mcp-tools) are automatically added by EdgeWorker
			const allowedTools = [
				"Read(**)",
				"Edit(**)",
				"Bash(git:*)",
				"Bash(gh:*)",
				"Task",
				"WebFetch",
				"WebSearch",
				"TodoRead",
				"TodoWrite",
				"NotebookRead",
				"NotebookEdit",
				"Batch",
			];

			// Label prompts - default to common label mappings
			const labelPrompts = {
				debugger: {
					labels: ["Bug"],
				},
				builder: {
					labels: ["Feature", "Improvement"],
				},
				scoper: {
					labels: ["PRD"],
				},
				orchestrator: {
					labels: ["Orchestrator"],
					allowedTools: "coordinator" as const, // Uses coordinator tools (all except file editing)
				},
			};

			if (shouldCloseRl) {
				rl.close();
			}

			// Create repository configuration
			const repository: RepositoryConfig = {
				id: `${linearCredentials.linearWorkspaceId}-${Date.now()}`,
				name: repositoryName,
				repositoryPath: resolve(repositoryPath),
				baseBranch,
				linearWorkspaceId: linearCredentials.linearWorkspaceId,
				linearToken: linearCredentials.linearToken,
				workspaceBaseDir: resolve(workspaceBaseDir),
				isActive: true,
				allowedTools,
				labelPrompts,
			};

			return repository;
		} catch (error) {
			if (shouldCloseRl) {
				rl.close();
			}
			throw error;
		}
	}

	/**
	 * Start OAuth flow to get Linear token using EdgeWorker's shared server
	 */
	async startOAuthFlow(proxyUrl: string): Promise<LinearCredentials> {
		if (this.edgeWorker) {
			// Use existing EdgeWorker's OAuth flow
			const port = this.edgeWorker.getServerPort();
			const callbackBaseUrl =
				process.env.CYRUS_BASE_URL || `http://localhost:${port}`;
			const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

			// Let SharedApplicationServer print the messages, but we handle browser opening
			const resultPromise = this.edgeWorker.startOAuthFlow(proxyUrl);

			// Open browser after SharedApplicationServer prints its messages
			open(authUrl).catch(() => {
				// Error is already communicated by SharedApplicationServer
			});

			return resultPromise;
		} else {
			// Create temporary SharedApplicationServer for OAuth flow during initial setup
			const serverPort = process.env.CYRUS_SERVER_PORT
				? parseInt(process.env.CYRUS_SERVER_PORT, 10)
				: 3456;
			const tempServer = new SharedApplicationServer(serverPort);

			try {
				// Start the server
				await tempServer.start();

				const port = tempServer.getPort();
				const callbackBaseUrl =
					process.env.CYRUS_BASE_URL || `http://localhost:${port}`;
				const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

				// Start OAuth flow (this prints the messages)
				const resultPromise = tempServer.startOAuthFlow(proxyUrl);

				// Open browser after SharedApplicationServer prints its messages
				open(authUrl).catch(() => {
					// Error is already communicated by SharedApplicationServer
				});

				// Wait for OAuth flow to complete
				const result = await resultPromise;

				return {
					linearToken: result.linearToken,
					linearWorkspaceId: result.linearWorkspaceId,
					linearWorkspaceName: result.linearWorkspaceName,
				};
			} finally {
				// Clean up temporary server
				await tempServer.stop();
			}
		}
	}

	/**
	 * Get ngrok auth token from config or prompt user
	 */
	async getNgrokAuthToken(config: EdgeConfig): Promise<string | undefined> {
		// Return existing token if available
		if (config.ngrokAuthToken) {
			return config.ngrokAuthToken;
		}

		// Skip ngrok setup if using external host
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		if (isExternalHost) {
			console.log(
				`\n📡 Using external host configuration (CYRUS_HOST_EXTERNAL=true)`,
			);
			console.log(
				`   Skipping ngrok setup - using ${process.env.CYRUS_BASE_URL || "configured base URL"}`,
			);
			return undefined;
		}

		// Prompt user for ngrok auth token
		console.log(`\n🔗 Ngrok Setup Required`);
		console.log(`─`.repeat(50));
		console.log(
			`Linear payloads need to reach your computer, so we use the secure technology ngrok for that.`,
		);
		console.log(`This requires a free ngrok account and auth token.`);
		console.log(``);
		console.log(`To get your ngrok auth token:`);
		console.log(`1. Sign up at https://ngrok.com/ (free)`);
		console.log(
			`2. Go to https://dashboard.ngrok.com/get-started/your-authtoken`,
		);
		console.log(`3. Copy your auth token`);
		console.log(``);
		console.log(
			`Alternatively, you can set CYRUS_HOST_EXTERNAL=true and CYRUS_BASE_URL`,
		);
		console.log(`to handle port forwarding or reverse proxy yourself.`);
		console.log(``);

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise((resolve) => {
			rl.question(
				`Enter your ngrok auth token (or press Enter to skip): `,
				async (token) => {
					rl.close();

					if (!token.trim()) {
						console.log(
							`\n⚠️  Skipping ngrok setup. You can set CYRUS_HOST_EXTERNAL=true and CYRUS_BASE_URL manually.`,
						);
						resolve(undefined);
						return;
					}

					// Save token to config
					config.ngrokAuthToken = token.trim();
					try {
						this.saveEdgeConfig(config);
						console.log(`✅ Ngrok auth token saved to config`);
						resolve(token.trim());
					} catch (error) {
						console.error(`❌ Failed to save ngrok auth token:`, error);
						resolve(token.trim()); // Still use the token for this session
					}
				},
			);
		});
	}

	/**
	 * Start the EdgeWorker with given configuration
	 */
	async startEdgeWorker({
		proxyUrl,
		repositories,
	}: {
		proxyUrl: string;
		repositories: RepositoryConfig[];
	}): Promise<void> {
		// Get ngrok auth token (prompt if needed and not external host)
		let ngrokAuthToken: string | undefined;
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		if (!isExternalHost) {
			const config = this.loadEdgeConfig();
			ngrokAuthToken = await this.getNgrokAuthToken(config);
		}

		// Create EdgeWorker configuration
		const config: EdgeWorkerConfig = {
			proxyUrl,
			repositories,
			cyrusHome: this.cyrusHome,
			defaultAllowedTools:
				process.env.ALLOWED_TOOLS?.split(",").map((t) => t.trim()) || [],
			defaultDisallowedTools:
				process.env.DISALLOWED_TOOLS?.split(",").map((t) => t.trim()) ||
				undefined,
			// Model configuration: environment variables take precedence over config file
			defaultModel:
				process.env.CYRUS_DEFAULT_MODEL || this.loadEdgeConfig().defaultModel,
			defaultFallbackModel:
				process.env.CYRUS_DEFAULT_FALLBACK_MODEL ||
				this.loadEdgeConfig().defaultFallbackModel,
			webhookBaseUrl: process.env.CYRUS_BASE_URL,
			serverPort: process.env.CYRUS_SERVER_PORT
				? parseInt(process.env.CYRUS_SERVER_PORT, 10)
				: 3456,
			serverHost: isExternalHost ? "0.0.0.0" : "localhost",
			ngrokAuthToken,
			features: {
				enableContinuation: true,
			},
			handlers: {
				createWorkspace: async (
					issue: Issue,
					repository: RepositoryConfig,
				): Promise<Workspace> => {
					return this.createGitWorktree(issue, repository);
				},
				onOAuthCallback: async (
					token: string,
					workspaceId: string,
					workspaceName: string,
				): Promise<void> => {
					const linearCredentials: LinearCredentials = {
						linearToken: token,
						linearWorkspaceId: workspaceId,
						linearWorkspaceName: workspaceName,
					};

					// Handle OAuth completion for repository setup
					if (this.edgeWorker) {
						console.log(
							"\n📋 Setting up new repository for workspace:",
							workspaceName,
						);
						console.log("─".repeat(50));

						try {
							const newRepo =
								await this.setupRepositoryWizard(linearCredentials);

							// Add to existing repositories
							const edgeConfig = this.loadEdgeConfig();
							console.log(
								`📊 Current config has ${
									edgeConfig.repositories?.length || 0
								} repositories`,
							);
							edgeConfig.repositories = [
								...(edgeConfig.repositories || []),
								newRepo,
							];
							console.log(
								`📊 Adding repository "${newRepo.name}", new total: ${edgeConfig.repositories.length}`,
							);
							this.saveEdgeConfig(edgeConfig);
							console.log("\n✅ Repository configured successfully!");
							console.log(
								"📝 ~/.cyrus/config.json file has been updated with your new repository configuration.",
							);
							console.log(
								"💡 You can edit this file and restart Cyrus at any time to modify settings.",
							);
							console.log(
								"📖 Configuration docs: https://github.com/ceedaragents/cyrus#configuration",
							);

							// Restart edge worker with new config
							await this.edgeWorker!.stop();
							this.edgeWorker = null;

							// Give a small delay to ensure file is written
							await new Promise((resolve) => setTimeout(resolve, 100));

							// Reload configuration and restart worker without going through setup
							const updatedConfig = this.loadEdgeConfig();
							console.log(
								`\n🔄 Reloading with ${
									updatedConfig.repositories?.length || 0
								} repositories from config file`,
							);

							return this.startEdgeWorker({
								proxyUrl,
								repositories: updatedConfig.repositories || [],
							});
						} catch (error) {
							console.error(
								"\n❌ Repository setup failed:",
								(error as Error).message,
							);
						}
					}
				},
			},
		};

		// Create and start EdgeWorker
		this.edgeWorker = new EdgeWorker(config);

		// Set up event handlers
		this.setupEventHandlers();

		// Start the worker
		await this.edgeWorker.start();

		console.log("\n✅ Edge worker started successfully");
		console.log(`Configured proxy URL: ${config.proxyUrl}`);
		console.log(`Managing ${repositories.length} repositories:`);
		repositories.forEach((repo) => {
			console.log(`  - ${repo.name} (${repo.repositoryPath})`);
		});
	}

	/**
	 * Check subscription status with the Cyrus API
	 */
	async checkSubscriptionStatus(customerId: string): Promise<{
		hasActiveSubscription: boolean;
		status: string;
		requiresPayment: boolean;
		isReturningCustomer?: boolean;
	}> {
		const response = await fetch(
			`https://www.atcyrus.com/api/subscription-status?customerId=${encodeURIComponent(customerId)}`,
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.ok) {
			if (response.status === 400) {
				const data = (await response.json()) as { error?: string };
				throw new Error(data.error || "Invalid customer ID format");
			}
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = (await response.json()) as {
			hasActiveSubscription: boolean;
			status: string;
			requiresPayment: boolean;
			isReturningCustomer?: boolean;
		};
		return data;
	}

	/**
	 * Validate customer ID format
	 */
	public validateCustomerId(customerId: string): void {
		if (!customerId.startsWith("cus_")) {
			console.error("\n❌ Invalid customer ID format");
			console.log('Customer IDs should start with "cus_"');
			process.exit(1);
		}
	}

	/**
	 * Handle subscription validation failure
	 */
	private handleSubscriptionFailure(subscriptionStatus: {
		hasActiveSubscription: boolean;
		status: string;
		requiresPayment: boolean;
		isReturningCustomer?: boolean;
	}): void {
		console.error("\n❌ Subscription Invalid");
		console.log("─".repeat(50));

		if (subscriptionStatus.isReturningCustomer) {
			console.log("Your subscription has expired or been cancelled.");
			console.log(`Status: ${subscriptionStatus.status}`);
			console.log(
				"\nPlease visit https://www.atcyrus.com/pricing to reactivate your subscription.",
			);
		} else {
			console.log("No active subscription found for this customer ID.");
			console.log(
				"\nPlease visit https://www.atcyrus.com/pricing to start a subscription.",
			);
			console.log("Once you obtain a valid customer ID,");
			console.log("Run: cyrus set-customer-id cus_XXXXX");
		}

		process.exit(1);
	}

	/**
	 * Validate subscription and handle failures
	 */
	public async validateAndHandleSubscription(
		customerId: string,
	): Promise<void> {
		console.log("\n🔐 Validating subscription...");
		try {
			const subscriptionStatus = await this.checkSubscriptionStatus(customerId);

			if (subscriptionStatus.requiresPayment) {
				this.handleSubscriptionFailure(subscriptionStatus);
			}

			console.log(`✅ Subscription active (${subscriptionStatus.status})`);
		} catch (error) {
			console.error("\n❌ Failed to validate subscription");
			console.log(`Error: ${(error as Error).message}`);
			console.log(
				'Run "cyrus set-customer-id cus_XXXXX" with a valid customer ID',
			);
			process.exit(1);
		}
	}

	/**
	 * Create readline interface and ask question
	 */
	public async askQuestion(prompt: string): Promise<string> {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise((resolve) => {
			rl.question(prompt, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		});
	}

	/**
	 * Start the edge application
	 */
	async start(): Promise<void> {
		try {
			// Set proxy URL with default
			const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;

			// No need to validate Claude CLI - using Claude TypeScript SDK now

			// Load edge configuration
			let edgeConfig = this.loadEdgeConfig();
			let repositories = edgeConfig.repositories || [];

			// Check if using default proxy URL without a customer ID
			const isUsingDefaultProxy = proxyUrl === DEFAULT_PROXY_URL;
			const hasCustomerId = !!edgeConfig.stripeCustomerId;

			if (isUsingDefaultProxy && !hasCustomerId) {
				console.log("\n🎯 Pro Plan Required");
				console.log("─".repeat(50));
				console.log("You are using the default Cyrus proxy URL.");
				console.log("\nWith Cyrus Pro you get:");
				console.log("• No-hassle configuration");
				console.log("• Priority support");
				console.log("• Help fund product development");
				console.log("\nChoose an option:");
				console.log("1. Start a free trial");
				console.log("2. I have a customer ID to enter");
				console.log("3. Setup your own proxy (advanced)");
				console.log("4. Exit");

				const choice = await this.askQuestion("\nYour choice (1-4): ");

				if (choice === "1") {
					console.log("\n👉 Opening your browser to start a free trial...");
					console.log("Visit: https://www.atcyrus.com/pricing");
					await open("https://www.atcyrus.com/pricing");
					process.exit(0);
				} else if (choice === "2") {
					console.log(
						"\n📋 After completing payment, you'll see your customer ID on the success page.",
					);
					console.log(
						'It starts with "cus_" and can be copied from the website.',
					);

					const customerId = await this.askQuestion(
						"\nPaste your customer ID here: ",
					);

					this.validateCustomerId(customerId);
					edgeConfig.stripeCustomerId = customerId;
					this.saveEdgeConfig(edgeConfig);

					console.log("✅ Customer ID saved successfully!");
					console.log("Continuing with startup...\n");

					// Reload config to include the new customer ID
					edgeConfig = this.loadEdgeConfig();
				} else if (choice === "3") {
					console.log("\n🔧 Self-Hosted Proxy Setup");
					console.log("─".repeat(50));
					console.log(
						"Configure your own Linear app and proxy to have full control over your stack.",
					);
					console.log("\nDocumentation:");
					console.log(
						"• Linear OAuth setup: https://linear.app/developers/agents",
					);
					console.log(
						"• Proxy implementation: https://github.com/ceedaragents/cyrus/tree/main/apps/proxy-worker",
					);
					console.log(
						"\nOnce deployed, set the PROXY_URL environment variable:",
					);
					console.log("export PROXY_URL=https://your-proxy-url.com");
					process.exit(0);
				} else {
					console.log("\nExiting...");
					process.exit(0);
				}
			}

			// If using default proxy and has customer ID, validate subscription
			if (isUsingDefaultProxy && edgeConfig.stripeCustomerId) {
				try {
					await this.validateAndHandleSubscription(edgeConfig.stripeCustomerId);
				} catch (error) {
					console.error("\n⚠️ Warning: Could not validate subscription");
					console.log("─".repeat(50));
					console.error(
						"Unable to connect to subscription service:",
						(error as Error).message,
					);
					process.exit(1);
				}
			}

			// Check if we need to set up
			const needsSetup = repositories.length === 0;
			const hasLinearCredentials =
				repositories.some((r) => r.linearToken) ||
				process.env.LINEAR_OAUTH_TOKEN;

			if (needsSetup) {
				console.log("🚀 Welcome to Cyrus Edge Worker!");

				// Check if they want to use existing credentials or add new workspace
				let linearCredentials: LinearCredentials | null = null;

				if (hasLinearCredentials) {
					// Show available workspaces from existing repos
					const workspaces = new Map<
						string,
						{ id: string; name: string; token: string }
					>();
					for (const repo of edgeConfig.repositories || []) {
						if (!workspaces.has(repo.linearWorkspaceId)) {
							workspaces.set(repo.linearWorkspaceId, {
								id: repo.linearWorkspaceId,
								name: "Unknown Workspace",
								token: repo.linearToken,
							});
						}
					}

					if (workspaces.size === 1) {
						// Only one workspace, use it
						const ws = Array.from(workspaces.values())[0];
						if (ws) {
							linearCredentials = {
								linearToken: ws.token,
								linearWorkspaceId: ws.id,
								linearWorkspaceName: ws.name,
							};
							console.log(
								`\n📋 Using Linear workspace: ${linearCredentials.linearWorkspaceName}`,
							);
						}
					} else if (workspaces.size > 1) {
						// Multiple workspaces, let user choose
						console.log("\n📋 Available Linear workspaces:");
						const workspaceList = Array.from(workspaces.values());
						workspaceList.forEach((ws, i) => {
							console.log(`${i + 1}. ${ws.name}`);
						});

						const choice = await this.askQuestion(
							"\nSelect workspace (number) or press Enter for new: ",
						);

						const index = parseInt(choice) - 1;
						if (index >= 0 && index < workspaceList.length) {
							const ws = workspaceList[index];
							if (ws) {
								linearCredentials = {
									linearToken: ws.token,
									linearWorkspaceId: ws.id,
									linearWorkspaceName: ws.name,
								};
								console.log(
									`Using workspace: ${linearCredentials.linearWorkspaceName}`,
								);
							}
						} else {
							// Get new credentials
							linearCredentials = null;
						}
					} else if (process.env.LINEAR_OAUTH_TOKEN) {
						// Use env vars
						linearCredentials = {
							linearToken: process.env.LINEAR_OAUTH_TOKEN,
							linearWorkspaceId: process.env.LINEAR_WORKSPACE_ID || "unknown",
							linearWorkspaceName: "Your Workspace",
						};
					}

					if (linearCredentials) {
						console.log(
							"(OAuth server will start with EdgeWorker to connect additional workspaces)",
						);
					}
				} else {
					// Get new Linear credentials
					console.log("\n📋 Step 1: Connect to Linear");
					console.log("─".repeat(50));

					try {
						linearCredentials = await this.startOAuthFlow(proxyUrl);
						console.log("\n✅ Linear connected successfully!");
					} catch (error) {
						console.error("\n❌ OAuth flow failed:", (error as Error).message);
						console.log("\nAlternatively, you can:");
						console.log(
							"1. Visit",
							`${proxyUrl}/oauth/authorize`,
							"in your browser",
						);
						console.log("2. Copy the token after authorization");
						console.log(
							"3. Add it to your .env.cyrus file as LINEAR_OAUTH_TOKEN",
						);
						process.exit(1);
					}
				}

				if (!linearCredentials) {
					console.error("❌ No Linear credentials available");
					process.exit(1);
				}

				// Now set up repository
				console.log("\n📋 Step 2: Configure Repository");
				console.log("─".repeat(50));

				// Create a single readline interface for the entire repository setup process
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});

				try {
					// Loop to allow adding multiple repositories
					let continueAdding = true;
					while (continueAdding) {
						try {
							const newRepo = await this.setupRepositoryWizard(
								linearCredentials,
								rl,
							);

							// Add to repositories
							repositories = [...(edgeConfig.repositories || []), newRepo];
							edgeConfig.repositories = repositories;
							this.saveEdgeConfig(edgeConfig);

							console.log("\n✅ Repository configured successfully!");
							console.log(
								"📝 ~/.cyrus/config.json file has been updated with your repository configuration.",
							);
							console.log(
								"💡 You can edit this file and restart Cyrus at any time to modify settings.",
							);
							console.log(
								"📖 Configuration docs: https://github.com/ceedaragents/cyrus#configuration",
							);

							// Ask if they want to add another
							const addAnother = await new Promise<boolean>((resolve) => {
								rl.question("\nAdd another repository? (y/N): ", (answer) => {
									resolve(answer.toLowerCase() === "y");
								});
							});

							continueAdding = addAnother;
							if (continueAdding) {
								console.log("\n📋 Configure Additional Repository");
								console.log("─".repeat(50));
							}
						} catch (error) {
							console.error(
								"\n❌ Repository setup failed:",
								(error as Error).message,
							);
							throw error;
						}
					}
				} finally {
					// Always close the readline interface when done
					rl.close();
				}
			}

			// Validate we have repositories
			if (repositories.length === 0) {
				console.error("❌ No repositories configured");
				console.log(
					"\nUse the authorization link above to configure your first repository.",
				);
				process.exit(1);
			}

			// Start the edge worker
			await this.startEdgeWorker({ proxyUrl, repositories });

			// Display plan status
			const isUsingDefaultProxyForStatus = proxyUrl === DEFAULT_PROXY_URL;
			const hasCustomerIdForStatus = !!edgeConfig.stripeCustomerId;

			console.log(`\n${"─".repeat(70)}`);
			if (isUsingDefaultProxyForStatus && hasCustomerIdForStatus) {
				console.log("💎 Plan: Cyrus Pro");
				console.log(`📋 Customer ID: ${edgeConfig.stripeCustomerId}`);
				console.log('💳 Manage subscription: Run "cyrus billing"');
			} else if (!isUsingDefaultProxyForStatus) {
				console.log("🛠️  Plan: Community (Self-hosted proxy)");
				console.log(`🔗 Proxy URL: ${proxyUrl}`);
			}
			console.log("─".repeat(70));

			// Display OAuth information after EdgeWorker is started
			const serverPort = this.edgeWorker?.getServerPort() || 3456;
			const oauthCallbackBaseUrl =
				process.env.CYRUS_BASE_URL || `http://localhost:${serverPort}`;
			console.log(`\n🔐 OAuth server running on port ${serverPort}`);
			console.log(`👉 To authorize Linear (new workspace or re-auth):`);
			console.log(
				`   ${proxyUrl}/oauth/authorize?callback=${oauthCallbackBaseUrl}/callback`,
			);
			console.log("─".repeat(70));

			// Handle graceful shutdown
			process.on("SIGINT", () => this.shutdown());
			process.on("SIGTERM", () => this.shutdown());

			// Handle uncaught exceptions and unhandled promise rejections
			process.on("uncaughtException", (error) => {
				console.error("🚨 Uncaught Exception:", error.message);
				console.error("Error type:", error.constructor.name);
				console.error("Stack:", error.stack);
				console.error(
					"This error was caught by the global handler, preventing application crash",
				);

				// Attempt graceful shutdown but don't wait indefinitely
				this.shutdown().finally(() => {
					console.error("Process exiting due to uncaught exception");
					process.exit(1);
				});
			});

			process.on("unhandledRejection", (reason, promise) => {
				console.error("🚨 Unhandled Promise Rejection at:", promise);
				console.error("Reason:", reason);
				console.error(
					"This rejection was caught by the global handler, continuing operation",
				);

				// Log stack trace if reason is an Error
				if (reason instanceof Error && reason.stack) {
					console.error("Stack:", reason.stack);
				}

				// Log the error but don't exit the process for promise rejections
				// as they might be recoverable
			});
		} catch (error: any) {
			console.error("\n❌ Failed to start edge application:", error.message);

			// Provide more specific guidance for common errors
			if (error.message?.includes("Failed to connect any repositories")) {
				console.error("\n💡 This usually happens when:");
				console.error("   - All Linear OAuth tokens have expired");
				console.error("   - The Linear API is temporarily unavailable");
				console.error("   - Your network connection is having issues");
				console.error("\nPlease check your edge configuration and try again.");
			}

			await this.shutdown();
			process.exit(1);
		}
	}

	/**
	 * Check if a branch exists locally or remotely
	 */
	async branchExists(branchName: string, repoPath: string): Promise<boolean> {
		const { execSync } = await import("node:child_process");

		try {
			// Check if branch exists locally
			execSync(`git rev-parse --verify "${branchName}"`, {
				cwd: repoPath,
				stdio: "pipe",
			});
			return true;
		} catch {
			// Branch doesn't exist locally, check remote
			try {
				const remoteOutput = execSync(
					`git ls-remote --heads origin "${branchName}"`,
					{
						cwd: repoPath,
						stdio: "pipe",
					},
				);
				// Check if output is non-empty (branch actually exists on remote)
				return remoteOutput && remoteOutput.toString().trim().length > 0;
			} catch {
				return false;
			}
		}
	}

	/**
	 * Set up event handlers for EdgeWorker
	 */
	setupEventHandlers(): void {
		if (!this.edgeWorker) return;

		// Session events
		this.edgeWorker.on(
			"session:started",
			(issueId: string, _issue: Issue, repositoryId: string) => {
				console.log(
					`Started session for issue ${issueId} in repository ${repositoryId}`,
				);
			},
		);

		this.edgeWorker.on(
			"session:ended",
			(issueId: string, exitCode: number | null, repositoryId: string) => {
				console.log(
					`Session for issue ${issueId} ended with exit code ${exitCode} in repository ${repositoryId}`,
				);
			},
		);

		// Connection events
		this.edgeWorker.on("connected", (token: string) => {
			console.log(
				`✅ Connected to proxy with token ending in ...${token.slice(-4)}`,
			);
		});

		this.edgeWorker.on("disconnected", (token: string, reason?: string) => {
			console.error(
				`❌ Disconnected from proxy (token ...${token.slice(-4)}): ${
					reason || "Unknown reason"
				}`,
			);
		});

		// Error events
		this.edgeWorker.on("error", (error: Error) => {
			console.error("EdgeWorker error:", error);
		});
	}

	/**
	 * Create a git worktree for an issue
	 */
	async createGitWorktree(
		issue: Issue,
		repository: RepositoryConfig,
	): Promise<Workspace> {
		const { execSync } = await import("node:child_process");
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");

		try {
			// Verify this is a git repository
			try {
				execSync("git rev-parse --git-dir", {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
			} catch (_e) {
				console.error(`${repository.repositoryPath} is not a git repository`);
				throw new Error("Not a git repository");
			}

			// Sanitize branch name by removing backticks to prevent command injection
			const sanitizeBranchName = (name: string): string =>
				name ? name.replace(/`/g, "") : name;

			// Use Linear's preferred branch name, or generate one if not available
			const rawBranchName =
				issue.branchName ||
				`${issue.identifier}-${issue.title
					?.toLowerCase()
					.replace(/\s+/g, "-")
					.substring(0, 30)}`;
			const branchName = sanitizeBranchName(rawBranchName);
			const workspacePath = join(repository.workspaceBaseDir, issue.identifier);

			// Ensure workspace directory exists
			mkdirSync(repository.workspaceBaseDir, { recursive: true });

			// Check if worktree already exists
			try {
				const worktrees = execSync("git worktree list --porcelain", {
					cwd: repository.repositoryPath,
					encoding: "utf-8",
				});

				if (worktrees.includes(workspacePath)) {
					console.log(
						`Worktree already exists at ${workspacePath}, using existing`,
					);
					return {
						path: workspacePath,
						isGitWorktree: true,
					};
				}
			} catch (_e) {
				// git worktree command failed, continue with creation
			}

			// Check if branch already exists
			let createBranch = true;
			try {
				execSync(`git rev-parse --verify "${branchName}"`, {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
				createBranch = false;
			} catch (_e) {
				// Branch doesn't exist, we'll create it
			}

			// Determine base branch for this issue
			let baseBranch = repository.baseBranch;

			// Check if issue has a parent
			try {
				const parent = await (issue as any).parent;
				if (parent) {
					console.log(
						`Issue ${issue.identifier} has parent: ${parent.identifier}`,
					);

					// Get parent's branch name
					const parentRawBranchName =
						parent.branchName ||
						`${parent.identifier}-${parent.title
							?.toLowerCase()
							.replace(/\s+/g, "-")
							.substring(0, 30)}`;
					const parentBranchName = sanitizeBranchName(parentRawBranchName);

					// Check if parent branch exists
					const parentBranchExists = await this.branchExists(
						parentBranchName,
						repository.repositoryPath,
					);

					if (parentBranchExists) {
						baseBranch = parentBranchName;
						console.log(
							`Using parent issue branch '${parentBranchName}' as base for sub-issue ${issue.identifier}`,
						);
					} else {
						console.log(
							`Parent branch '${parentBranchName}' not found, using default base branch '${repository.baseBranch}'`,
						);
					}
				}
			} catch (_error) {
				// Parent field might not exist or couldn't be fetched, use default base branch
				console.log(
					`No parent issue found for ${issue.identifier}, using default base branch '${repository.baseBranch}'`,
				);
			}

			// Fetch latest changes from remote
			console.log("Fetching latest changes from remote...");
			let hasRemote = true;
			try {
				execSync("git fetch origin", {
					cwd: repository.repositoryPath,
					stdio: "pipe",
				});
			} catch (e) {
				console.warn(
					"Warning: git fetch failed, proceeding with local branch:",
					(e as Error).message,
				);
				hasRemote = false;
			}

			// Create the worktree - use determined base branch
			let worktreeCmd: string;
			if (createBranch) {
				if (hasRemote) {
					// Check if the base branch exists remotely
					let useRemoteBranch = false;
					try {
						const remoteOutput = execSync(
							`git ls-remote --heads origin "${baseBranch}"`,
							{
								cwd: repository.repositoryPath,
								stdio: "pipe",
							},
						);
						// Check if output is non-empty (branch actually exists on remote)
						useRemoteBranch =
							remoteOutput && remoteOutput.toString().trim().length > 0;
						if (!useRemoteBranch) {
							console.log(
								`Base branch '${baseBranch}' not found on remote, checking locally...`,
							);
						}
					} catch {
						// Base branch doesn't exist remotely, use local or fall back to default
						console.log(
							`Base branch '${baseBranch}' not found on remote, checking locally...`,
						);
					}

					if (useRemoteBranch) {
						// Use remote version of base branch
						const remoteBranch = `origin/${baseBranch}`;
						console.log(
							`Creating git worktree at ${workspacePath} from ${remoteBranch}`,
						);
						worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${remoteBranch}"`;
					} else {
						// Check if base branch exists locally
						try {
							execSync(`git rev-parse --verify "${baseBranch}"`, {
								cwd: repository.repositoryPath,
								stdio: "pipe",
							});
							// Use local base branch
							console.log(
								`Creating git worktree at ${workspacePath} from local ${baseBranch}`,
							);
							worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${baseBranch}"`;
						} catch {
							// Base branch doesn't exist locally either, fall back to remote default
							console.log(
								`Base branch '${baseBranch}' not found locally, falling back to remote ${repository.baseBranch}`,
							);
							const defaultRemoteBranch = `origin/${repository.baseBranch}`;
							worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${defaultRemoteBranch}"`;
						}
					}
				} else {
					// No remote, use local branch
					console.log(
						`Creating git worktree at ${workspacePath} from local ${baseBranch}`,
					);
					worktreeCmd = `git worktree add "${workspacePath}" -b "${branchName}" "${baseBranch}"`;
				}
			} else {
				// Branch already exists, just check it out
				console.log(
					`Creating git worktree at ${workspacePath} with existing branch ${branchName}`,
				);
				worktreeCmd = `git worktree add "${workspacePath}" "${branchName}"`;
			}

			execSync(worktreeCmd, {
				cwd: repository.repositoryPath,
				stdio: "pipe",
			});

			// Check for setup scripts in the repository root (cross-platform)
			const isWindows = process.platform === "win32";
			const setupScripts = [
				{
					file: "cyrus-setup.sh",
					command: "bash cyrus-setup.sh",
					platform: "unix",
				},
				{
					file: "cyrus-setup.ps1",
					command: "powershell -ExecutionPolicy Bypass -File cyrus-setup.ps1",
					platform: "windows",
				},
				{
					file: "cyrus-setup.cmd",
					command: "cyrus-setup.cmd",
					platform: "windows",
				},
				{
					file: "cyrus-setup.bat",
					command: "cyrus-setup.bat",
					platform: "windows",
				},
			];

			// Find the first available setup script for the current platform
			const availableScript = setupScripts.find((script) => {
				const scriptPath = join(repository.repositoryPath, script.file);
				const isCompatible = isWindows
					? script.platform === "windows"
					: script.platform === "unix";
				return existsSync(scriptPath) && isCompatible;
			});

			// Fallback: on Windows, try bash if no Windows scripts found (for Git Bash/WSL users)
			const fallbackScript =
				!availableScript && isWindows
					? setupScripts.find((script) => {
							const scriptPath = join(repository.repositoryPath, script.file);
							return script.platform === "unix" && existsSync(scriptPath);
						})
					: null;

			const scriptToRun = availableScript || fallbackScript;

			if (scriptToRun) {
				console.log(`Running ${scriptToRun.file} in new worktree...`);
				try {
					execSync(scriptToRun.command, {
						cwd: workspacePath,
						stdio: "inherit",
						env: {
							...process.env,
							LINEAR_ISSUE_ID: issue.id,
							LINEAR_ISSUE_IDENTIFIER: issue.identifier,
							LINEAR_ISSUE_TITLE: issue.title || "",
						},
					});
				} catch (error) {
					console.warn(
						`Warning: ${scriptToRun.file} failed:`,
						(error as Error).message,
					);
					// Continue despite setup script failure
				}
			}

			return {
				path: workspacePath,
				isGitWorktree: true,
			};
		} catch (error) {
			console.error("Failed to create git worktree:", (error as Error).message);
			// Fall back to regular directory if git worktree fails
			const fallbackPath = join(repository.workspaceBaseDir, issue.identifier);
			mkdirSync(fallbackPath, { recursive: true });
			return {
				path: fallbackPath,
				isGitWorktree: false,
			};
		}
	}

	/**
	 * Shut down the application
	 */
	async shutdown(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		console.log("\nShutting down edge worker...");

		// Stop edge worker (includes stopping shared application server)
		if (this.edgeWorker) {
			await this.edgeWorker.stop();
		}

		console.log("Shutdown complete");
		process.exit(0);
	}
}

// Helper function to check Linear token status
async function checkLinearToken(
	token: string,
): Promise<{ valid: boolean; error?: string }> {
	try {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: token,
			},
			body: JSON.stringify({
				query: "{ viewer { id email name } }",
			}),
		});

		const data = (await response.json()) as any;

		if (data.errors) {
			return {
				valid: false,
				error: data.errors[0]?.message || "Unknown error",
			};
		}

		return { valid: true };
	} catch (error) {
		return { valid: false, error: (error as Error).message };
	}
}

// Command: check-tokens
async function checkTokensCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	if (!existsSync(configPath)) {
		console.error("No edge configuration found. Please run setup first.");
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;

	console.log("Checking Linear tokens...\n");

	for (const repo of config.repositories) {
		process.stdout.write(`${repo.name} (${repo.linearWorkspaceName}): `);
		const result = await checkLinearToken(repo.linearToken);

		if (result.valid) {
			console.log("✅ Valid");
		} else {
			console.log(`❌ Invalid - ${result.error}`);
		}
	}
}

// Command: refresh-token
async function refreshTokenCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	if (!existsSync(configPath)) {
		console.error("No edge configuration found. Please run setup first.");
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;

	// Show repositories with their token status
	console.log("Checking current token status...\n");
	const tokenStatuses: Array<{ repo: RepositoryConfig; valid: boolean }> = [];

	for (const repo of config.repositories) {
		const result = await checkLinearToken(repo.linearToken);
		tokenStatuses.push({ repo, valid: result.valid });
		console.log(
			`${tokenStatuses.length}. ${repo.name} (${repo.linearWorkspaceName}): ${
				result.valid ? "✅ Valid" : "❌ Invalid"
			}`,
		);
	}

	// Ask which token to refresh
	const answer = await app.askQuestion(
		'\nWhich repository token would you like to refresh? (Enter number or "all"): ',
	);

	const indicesToRefresh: number[] = [];

	if (answer.toLowerCase() === "all") {
		indicesToRefresh.push(
			...Array.from({ length: tokenStatuses.length }, (_, i) => i),
		);
	} else {
		const index = parseInt(answer) - 1;
		if (Number.isNaN(index) || index < 0 || index >= tokenStatuses.length) {
			console.error("Invalid selection");
			process.exit(1);
		}
		indicesToRefresh.push(index);
	}

	// Refresh tokens
	for (const index of indicesToRefresh) {
		const tokenStatus = tokenStatuses[index];
		if (!tokenStatus) continue;

		const { repo } = tokenStatus;
		console.log(
			`\nRefreshing token for ${repo.name} (${
				repo.linearWorkspaceName || repo.linearWorkspaceId
			})...`,
		);
		console.log("Opening Linear OAuth flow in your browser...");

		// Use the proxy's OAuth flow with a callback to localhost
		const serverPort = process.env.CYRUS_SERVER_PORT
			? parseInt(process.env.CYRUS_SERVER_PORT, 10)
			: 3456;
		const callbackUrl = `http://localhost:${serverPort}/callback`;
		const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;
		const oauthUrl = `${proxyUrl}/oauth/authorize?callback=${encodeURIComponent(
			callbackUrl,
		)}`;

		console.log(`\nPlease complete the OAuth flow in your browser.`);
		console.log(
			`If the browser doesn't open automatically, visit:\n${oauthUrl}\n`,
		);

		// Start a temporary server to receive the OAuth callback
		let tokenReceived: string | null = null;

		const server = await new Promise<any>((resolve) => {
			const s = http.createServer((req: any, res: any) => {
				if (req.url?.startsWith("/callback")) {
					const url = new URL(req.url, `http://localhost:${serverPort}`);
					tokenReceived = url.searchParams.get("token");

					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(`
            <html>
              <head>
                <meta charset="UTF-8">
              </head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h2>✅ Authorization successful!</h2>
                <p>You can close this window and return to your terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
				} else {
					res.writeHead(404);
					res.end("Not found");
				}
			});
			s.listen(serverPort, () => {
				console.log("Waiting for OAuth callback...");
				resolve(s);
			});
		});

		await open(oauthUrl);

		// Wait for the token with timeout
		const startTime = Date.now();
		while (!tokenReceived && Date.now() - startTime < 120000) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		server.close();

		const newToken = tokenReceived;

		if (!newToken || !(newToken as string).startsWith("lin_oauth_")) {
			console.error("Invalid token received from OAuth flow");
			continue;
		}

		// Verify the new token
		const verifyResult = await checkLinearToken(newToken);
		if (!verifyResult.valid) {
			console.error(`❌ New token is invalid: ${verifyResult.error}`);
			continue;
		}

		// Update the config - update ALL repositories that had the same old token
		const oldToken = repo.linearToken;
		let updatedCount = 0;

		for (let i = 0; i < config.repositories.length; i++) {
			const currentRepo = config.repositories[i];
			if (currentRepo && currentRepo.linearToken === oldToken) {
				currentRepo.linearToken = newToken;
				updatedCount++;
				console.log(`✅ Updated token for ${currentRepo.name}`);
			}
		}

		if (updatedCount > 1) {
			console.log(
				`\n📝 Updated ${updatedCount} repositories that shared the same token`,
			);
		}
	}

	// Save the updated config
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	console.log("\n✅ Configuration saved");
}

// Command: add-repository
async function addRepositoryCommand() {
	const app = new EdgeApp(CYRUS_HOME);

	console.log("📋 Add New Repository");
	console.log("─".repeat(50));
	console.log();

	try {
		// Load existing configuration
		const config = app.loadEdgeConfig();

		// Check if we have any Linear credentials
		const existingRepos = config.repositories || [];
		let linearCredentials: LinearCredentials | null = null;

		if (existingRepos.length > 0) {
			// Try to get credentials from existing repositories
			const repoWithToken = existingRepos.find((r) => r.linearToken);
			if (repoWithToken) {
				linearCredentials = {
					linearToken: repoWithToken.linearToken,
					linearWorkspaceId: repoWithToken.linearWorkspaceId,
					linearWorkspaceName:
						repoWithToken.linearWorkspaceName || "Your Workspace",
				};
				console.log(`✅ Using Linear credentials from existing configuration`);
				console.log(`   Workspace: ${linearCredentials.linearWorkspaceName}`);
			}
		}

		// If no credentials found, run OAuth flow
		if (!linearCredentials) {
			console.log("🔐 No Linear credentials found. Starting OAuth flow...");

			// Start OAuth flow using the default proxy URL
			const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;
			linearCredentials = await app.startOAuthFlow(proxyUrl);

			if (!linearCredentials) {
				throw new Error("OAuth flow cancelled or failed");
			}
		}

		// Now set up the new repository
		console.log("\n📂 Configure New Repository");
		console.log("─".repeat(50));

		const newRepo = await app.setupRepositoryWizard(linearCredentials);

		// Add to existing repositories
		config.repositories = [...existingRepos, newRepo];

		// Save the updated configuration
		app.saveEdgeConfig(config);

		console.log("\n✅ Repository added successfully!");
		console.log(`📁 Repository: ${newRepo.name}`);
		console.log(`🔗 Path: ${newRepo.repositoryPath}`);
		console.log(`🌿 Base branch: ${newRepo.baseBranch}`);
		console.log(`📂 Workspace directory: ${newRepo.workspaceBaseDir}`);
	} catch (error) {
		console.error("\n❌ Failed to add repository:", error);
		throw error;
	}
}

// Command: set-customer-id
async function setCustomerIdCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	// Get customer ID from command line args
	const customerId = args[1];

	if (!customerId) {
		console.error("Please provide a customer ID");
		console.log("Usage: cyrus set-customer-id cus_XXXXX");
		process.exit(1);
	}

	app.validateCustomerId(customerId);

	try {
		// Check if using default proxy
		const proxyUrl = process.env.PROXY_URL || DEFAULT_PROXY_URL;
		const isUsingDefaultProxy = proxyUrl === DEFAULT_PROXY_URL;

		// Validate subscription for default proxy users
		if (isUsingDefaultProxy) {
			await app.validateAndHandleSubscription(customerId);
		}

		// Load existing config or create new one
		let config: EdgeConfig = { repositories: [] };

		if (existsSync(configPath)) {
			config = JSON.parse(readFileSync(configPath, "utf-8"));
		}

		// Update customer ID
		config.stripeCustomerId = customerId;

		// Save config
		app.saveEdgeConfig(config);

		console.log("\n✅ Customer ID saved successfully!");
		console.log("─".repeat(50));
		console.log(`Customer ID: ${customerId}`);
		if (isUsingDefaultProxy) {
			console.log("\nYou now have access to Cyrus Pro features.");
		}
		console.log('Run "cyrus" to start the edge worker.');
	} catch (error) {
		console.error("Failed to save customer ID:", (error as Error).message);
		process.exit(1);
	}
}

// Command: billing
async function billingCommand() {
	const app = new EdgeApp(CYRUS_HOME);
	const configPath = app.getEdgeConfigPath();

	if (!existsSync(configPath)) {
		console.error(
			'No configuration found. Please run "cyrus" to set up first.',
		);
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;

	if (!config.stripeCustomerId) {
		console.log("\n🎯 No Pro Plan Active");
		console.log("─".repeat(50));
		console.log("You don't have an active subscription.");
		console.log("Please start a free trial at:");
		console.log("\n  https://www.atcyrus.com/pricing\n");
		console.log(
			"After signing up, your customer ID will be saved automatically.",
		);
		process.exit(0);
	}

	console.log("\n🌐 Opening Billing Portal...");
	console.log("─".repeat(50));

	try {
		// Open atcyrus.com with the customer ID to handle Stripe redirect
		const billingUrl = `https://www.atcyrus.com/billing/${config.stripeCustomerId}`;

		console.log("✅ Opening billing portal in browser...");
		console.log(`\n👉 URL: ${billingUrl}\n`);

		// Open the billing portal URL in the default browser
		await open(billingUrl);

		console.log("The billing portal should now be open in your browser.");
		console.log(
			"You can manage your subscription, update payment methods, and download invoices.",
		);
	} catch (error) {
		console.error(
			"❌ Failed to open billing portal:",
			(error as Error).message,
		);
		console.log("\nPlease visit: https://www.atcyrus.com/billing");
		console.log("Customer ID:", config.stripeCustomerId);
		process.exit(1);
	}
}

// Parse command
const command = args[0] || "start";

// Execute appropriate command
switch (command) {
	case "check-tokens":
		checkTokensCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "refresh-token":
		refreshTokenCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "add-repository":
		addRepositoryCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "billing":
		billingCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	case "set-customer-id":
		setCustomerIdCommand().catch((error) => {
			console.error("Error:", error);
			process.exit(1);
		});
		break;

	default: {
		// Create and start the app
		const app = new EdgeApp(CYRUS_HOME);
		app.start().catch((error) => {
			console.error("Fatal error:", error);
			process.exit(1);
		});
		break;
	}
}
