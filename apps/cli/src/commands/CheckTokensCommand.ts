import { BaseCommand } from "./ICommand.js";

/**
 * Helper function to check Linear token status
 */
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

/**
 * Check tokens command - check the status of all Linear tokens
 */
export class CheckTokensCommand extends BaseCommand {
	async execute(_args: string[]): Promise<void> {
		if (!this.app.config.exists()) {
			this.logError("No edge configuration found. Please run setup first.");
			process.exit(1);
		}

		const config = this.app.config.load();

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
}
