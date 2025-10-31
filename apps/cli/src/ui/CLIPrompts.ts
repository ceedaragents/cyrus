import readline from "node:readline";

/**
 * Utility namespace for CLI prompts and user interaction
 */
export namespace CLIPrompts {
	/**
	 * Ask a question and return the user's answer
	 */
	export async function ask(prompt: string): Promise<string> {
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
	 * Ask a yes/no question
	 */
	export async function confirm(
		prompt: string,
		defaultValue = false,
	): Promise<boolean> {
		const suffix = defaultValue ? " (Y/n): " : " (y/N): ";
		const answer = await CLIPrompts.ask(prompt + suffix);

		if (!answer) {
			return defaultValue;
		}

		return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
	}

	/**
	 * Display a menu and get user selection
	 */
	export async function menu(
		title: string,
		options: string[],
	): Promise<number | null> {
		console.log(`\n${title}`);
		console.log("─".repeat(50));

		options.forEach((option, index) => {
			console.log(`${index + 1}. ${option}`);
		});

		const answer = await CLIPrompts.ask("\nYour choice: ");
		const choice = parseInt(answer, 10);

		if (Number.isNaN(choice) || choice < 1 || choice > options.length) {
			return null;
		}

		return choice - 1;
	}
}
