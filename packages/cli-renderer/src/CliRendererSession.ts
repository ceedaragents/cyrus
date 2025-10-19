import type {
	IRendererActivity,
	IRendererMessage,
	IRendererSession,
	IRendererStatus,
	ISessionContext,
} from "@cyrus/abstractions";
import chalk from "chalk";
import ora, { type Ora } from "ora";

export class CliRendererSession implements IRendererSession {
	readonly id: string;
	readonly context: ISessionContext;
	private metadata: Record<string, unknown> = {};
	private spinner?: Ora;
	private activities: IRendererActivity[] = [];

	constructor(context: ISessionContext) {
		this.context = context;
		this.id = context.taskId;
	}

	async initialize(): Promise<void> {
		const title = this.context.title;
		const desc = this.context.description;
		console.log(chalk.bold.blue(`\n━━━ Task: ${title} ━━━\n`));
		if (desc) {
			console.log(chalk.gray(desc));
			console.log();
		}
	}

	async writeMessage(message: IRendererMessage): Promise<void> {
		const timestamp = message.timestamp.toISOString().substring(11, 19);
		const type = message.type.toUpperCase();
		let colorFn = chalk.white;
		if (message.type === "user") colorFn = chalk.green;
		if (message.type === "assistant") colorFn = chalk.blue;
		if (message.type === "system") colorFn = chalk.gray;
		if (message.type === "error") colorFn = chalk.red;

		console.log(
			`${chalk.gray(timestamp)} ${colorFn(type)}: ${message.content}`,
		);
	}

	async writeActivity(activity: IRendererActivity): Promise<void> {
		this.activities.push(activity);
		const timestamp = activity.timestamp.toISOString().substring(11, 19);
		let icon = "•";
		if (activity.type === "thinking") icon = "💭";
		if (activity.type === "tool-use") icon = "🛠️";
		if (activity.type === "result") icon = "✅";
		if (activity.type === "error") icon = "❌";
		if (activity.type === "status") icon = "ℹ️";

		const details = activity.details
			? chalk.gray(` - ${activity.details}`)
			: "";
		console.log(
			`${chalk.gray(timestamp)} ${icon} ${activity.description}${details}`,
		);
	}

	async updateStatus(status: IRendererStatus): Promise<void> {
		if (this.spinner) {
			this.spinner.stop();
		}

		const text = status.message || status.state;
		const progress = status.progress ? ` (${status.progress}%)` : "";
		const fullText = text + progress;

		switch (status.state) {
			case "thinking":
				this.spinner = ora({ text: fullText, color: "yellow" }).start();
				break;
			case "working":
				this.spinner = ora({ text: fullText, color: "blue" }).start();
				break;
			case "completed":
				console.log(chalk.green(`✓ ${text}`));
				break;
			case "failed":
				console.log(chalk.red(`✗ ${text}`));
				break;
			case "waiting":
				this.spinner = ora({ text: fullText, color: "cyan" }).start();
				break;
			default:
				console.log(chalk.gray(text));
		}
	}

	getMetadata(): Record<string, unknown> {
		return { ...this.metadata };
	}

	async updateMetadata(metadata: Record<string, unknown>): Promise<void> {
		this.metadata = { ...this.metadata, ...metadata };
	}

	async close(): Promise<void> {
		if (this.spinner) {
			this.spinner.stop();
		}
		console.log(
			chalk.bold.blue(`\n━━━ End of Task: ${this.context.title} ━━━\n`),
		);
	}
}
