/**
 * Init Test Repo command - Initialize a test repository with a rate limiter library
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
	GITIGNORE_TEMPLATE,
	INDEX_TS_TEMPLATE,
	PACKAGE_JSON_TEMPLATE,
	RATE_LIMITER_TS_TEMPLATE,
	README_MD_TEMPLATE,
	TSCONFIG_JSON_TEMPLATE,
	TYPES_TS_TEMPLATE,
} from "../templates/index.js";
import { dim, error, success } from "../utils/colors.js";

export function createInitTestRepoCommand(): Command {
	const cmd = new Command("init-test-repo");

	cmd
		.description(
			"Initialize a test repository with a partially-complete rate limiter library",
		)
		.requiredOption(
			"-p, --path <directory>",
			"Target directory path for the test repository",
		)
		.action(async (options: { path: string }) => {
			const targetPath = options.path;

			// Validate the target path
			if (!targetPath || targetPath.trim() === "") {
				console.error(error("Target path is required. Use --path <directory>"));
				process.exit(1);
			}

			// Check if the directory already exists
			if (existsSync(targetPath)) {
				console.error(error(`Directory already exists: ${targetPath}`));
				console.error(
					"  Please choose a different path or remove the existing directory.",
				);
				process.exit(1);
			}

			try {
				console.log(`Creating test repository at: ${targetPath}\n`);

				// Create the directory structure
				await mkdir(targetPath, { recursive: true });
				await mkdir(join(targetPath, "src"), { recursive: true });

				// Write all template files
				const files = [
					{ path: "package.json", content: PACKAGE_JSON_TEMPLATE },
					{ path: "tsconfig.json", content: TSCONFIG_JSON_TEMPLATE },
					{ path: ".gitignore", content: GITIGNORE_TEMPLATE },
					{ path: "README.md", content: README_MD_TEMPLATE },
					{ path: "src/types.ts", content: TYPES_TS_TEMPLATE },
					{ path: "src/rate-limiter.ts", content: RATE_LIMITER_TS_TEMPLATE },
					{ path: "src/index.ts", content: INDEX_TS_TEMPLATE },
				];

				for (const file of files) {
					const filePath = join(targetPath, file.path);
					await writeFile(filePath, file.content, "utf-8");
					console.log(success(`Created ${file.path}`));
				}
				// Initialize git repository with main branch
				console.log(dim("\nInitializing git repository..."));
				execSync("git init -b main", { cwd: targetPath, stdio: "pipe" });
				console.log(success("Initialized git repository with 'main' branch"));

				// Make initial commit so worktrees can be created
				execSync("git add .", { cwd: targetPath, stdio: "pipe" });
				execSync(
					'git commit -m "Initial commit: rate limiter library scaffold"',
					{ cwd: targetPath, stdio: "pipe" },
				);
				console.log(success("Created initial commit"));

				console.log(`\n${success("Test repository created successfully!")}\n`);
				console.log("Next steps:");
				console.log(`  cd ${targetPath}`);
				console.log("  npm install");
				console.log("  npm run typecheck");
				console.log("  npm run build\n");
				console.log(
					"The repository contains a partially-complete rate limiter library:",
				);
				console.log("  ✓ Token bucket algorithm (implemented)");
				console.log("  ✗ Sliding window algorithm (TODO)");
				console.log("  ✗ Fixed window algorithm (TODO)");
				console.log("  ✗ Redis storage adapter (TODO)");
				console.log("  ✗ Unit tests (TODO)\n");
			} catch (err) {
				if (err instanceof Error) {
					console.error(
						error(`Failed to create test repository: ${err.message}`),
					);
				} else {
					console.error(
						error("Failed to create test repository: Unknown error"),
					);
				}
				process.exit(1);
			}
		});

	return cmd;
}
