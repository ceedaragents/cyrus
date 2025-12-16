import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { BaseCommand } from "./ICommand.js";

/**
 * Self-add-repo command - clones a repo and adds it to config.json
 *
 * Usage:
 *   cyrus self-add-repo                      # prompts for everything
 *   cyrus self-add-repo <url>                # prompts for workspace if multiple
 *   cyrus self-add-repo <url> <workspace>    # no prompts
 */
export class SelfAddRepoCommand extends BaseCommand {
	private rl: readline.Interface | null = null;

	private getReadline(): readline.Interface {
		if (!this.rl) {
			this.rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
		}
		return this.rl;
	}

	private prompt(question: string): Promise<string> {
		return new Promise((resolve) => {
			this.getReadline().question(question, (answer) => resolve(answer.trim()));
		});
	}

	private cleanup(): void {
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
	}

	async execute(args: string[]): Promise<void> {
		let url = args[0];
		const workspaceName = args[1];

		try {
			// Load config
			const configPath = resolve(this.app.cyrusHome, "config.json");
			let config: any;
			try {
				config = JSON.parse(readFileSync(configPath, "utf-8"));
			} catch {
				this.logError(`Config file not found: ${configPath}`);
				process.exit(1);
			}

			if (!config.repositories) {
				config.repositories = [];
			}

			// Get URL if not provided
			if (!url) {
				url = await this.prompt("Repository URL: ");
				if (!url) {
					this.logError("URL is required");
					process.exit(1);
				}
			}

			// Extract repo name from URL
			const repoName = url
				.split("/")
				.pop()
				?.replace(/\.git$/, "");
			if (!repoName) {
				this.logError("Could not extract repo name from URL");
				process.exit(1);
			}

			// Check for duplicate
			if (config.repositories.some((r: any) => r.name === repoName)) {
				this.logError(`Repository '${repoName}' already exists in config`);
				process.exit(1);
			}

			// Find workspaces with Linear credentials
			const workspaces = new Map<string, any>();
			for (const repo of config.repositories) {
				if (
					repo.linearWorkspaceId &&
					repo.linearToken &&
					!workspaces.has(repo.linearWorkspaceId)
				) {
					workspaces.set(repo.linearWorkspaceId, {
						id: repo.linearWorkspaceId,
						name: repo.linearWorkspaceName || repo.linearWorkspaceId,
						token: repo.linearToken,
						refreshToken: repo.linearRefreshToken,
					});
				}
			}

			if (workspaces.size === 0) {
				this.logError(
					"No Linear credentials found. Run 'cyrus self-auth' first.",
				);
				process.exit(1);
			}

			// Get workspace
			let selectedWorkspace: any;
			const workspaceList = Array.from(workspaces.values());

			if (workspaceList.length === 1) {
				selectedWorkspace = workspaceList[0];
			} else if (workspaceName) {
				selectedWorkspace = workspaceList.find((w) => w.name === workspaceName);
				if (!selectedWorkspace) {
					this.logError(`Workspace '${workspaceName}' not found`);
					process.exit(1);
				}
			} else {
				console.log("\nAvailable workspaces:");
				workspaceList.forEach((w, i) => {
					console.log(`  ${i + 1}. ${w.name}`);
				});
				const choice = await this.prompt(
					`Select workspace [1-${workspaceList.length}]: `,
				);
				const idx = parseInt(choice, 10) - 1;
				if (idx < 0 || idx >= workspaceList.length) {
					this.logError("Invalid selection");
					process.exit(1);
				}
				selectedWorkspace = workspaceList[idx];
			}

			// Clone the repo
			const repositoryPath = resolve(this.app.cyrusHome, "repos", repoName);

			if (existsSync(repositoryPath)) {
				console.log(`Repository already exists at ${repositoryPath}`);
			} else {
				console.log(`Cloning ${url}...`);
				try {
					execSync(`git clone ${url} ${repositoryPath}`, { stdio: "inherit" });
				} catch {
					this.logError("Failed to clone repository");
					process.exit(1);
				}
			}

			// Generate UUID and add to config
			const id = randomUUID();

			config.repositories.push({
				id,
				name: repoName,
				repositoryPath,
				baseBranch: "main",
				workspaceBaseDir: resolve(this.app.cyrusHome, "worktrees"),
				linearWorkspaceId: selectedWorkspace.id,
				linearWorkspaceName: selectedWorkspace.name,
				linearToken: selectedWorkspace.token,
				linearRefreshToken: selectedWorkspace.refreshToken,
				isActive: true,
			});

			writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");

			console.log(`\nAdded: ${repoName}`);
			console.log(`  ID: ${id}`);
			console.log(`  Workspace: ${selectedWorkspace.name}`);
			process.exit(0);
		} finally {
			this.cleanup();
		}
	}
}
