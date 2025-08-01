import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type Issue,
	Session,
	SessionManager,
	type Workspace,
} from "cyrus-core";

interface ProcessorConfig {
	linearToken: string;
	claudePath: string;
	workspaceBaseDir: string;
}

export class EventProcessor extends EventEmitter {
	private config: ProcessorConfig;
	private sessionManager = new SessionManager();

	constructor(config: ProcessorConfig) {
		super();
		this.config = config;
	}

	async processEvent(event: any): Promise<void> {
		console.log("Processing event:", event.type, event.data?.webhookType);
		console.log("Event data:", JSON.stringify(event.data, null, 2));

		switch (event.type) {
			case "webhook":
				await this.handleWebhook(event);
				break;
			case "heartbeat":
				// Just acknowledge heartbeats
				break;
			default:
				console.warn("Unknown event type:", event.type);
		}
	}

	private async handleWebhook(event: any): Promise<void> {
		const webhook = event.data;

		// Linear webhook structure: { type, action, data, ... }
		// For notifications: { type: 'AppUserNotification', notification: { type: 'issueAssignedToYou', ... } }

		if (webhook.type === "AppUserNotification") {
			const notificationType = webhook.notification?.type;
			const issue = webhook.notification?.issue;

			switch (notificationType) {
				case "issueAssignedToYou":
					await this.handleIssueAssigned(issue);
					break;
				case "issueCommentMention":
				case "issueCommentReply":
					await this.handleComment({ issue, comment: webhook.notification });
					break;
				default:
					console.log("Unhandled notification type:", notificationType);
			}
		} else {
			console.log("Unhandled webhook type:", webhook.type);
		}
	}

	private async handleIssueAssigned(issueData: any): Promise<void> {
		if (!issueData) {
			console.error("No issue data provided to handleIssueAssigned");
			return;
		}

		console.log(
			"Handling issue assigned:",
			issueData.identifier,
			issueData.title,
		);

		// Create workspace directory
		const workspaceDir = join(
			this.config.workspaceBaseDir,
			`issue-${issueData.id}`,
		);
		await mkdir(workspaceDir, { recursive: true });

		// Create Issue object that implements the interface
		const issue: Issue = {
			id: issueData.id,
			identifier: issueData.identifier,
			title: issueData.title,
			description: issueData.description,
			getBranchName: () =>
				`${issueData.identifier.toLowerCase()}-${issueData.title.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`,
		};

		// Create Workspace object
		const workspace: Workspace = {
			path: workspaceDir,
			isGitWorktree: false,
			historyPath: join(workspaceDir, "conversation-history.jsonl"),
		};

		// Create a prompt file for Claude
		const prompt = `
You are working on Linear issue ${issue.identifier}: ${issue.title}

Description:
${issue.description || "No description provided"}

Please help solve this issue.
`;

		await writeFile(join(workspaceDir, "prompt.md"), prompt);

		// Start Claude session with jq for robust JSON processing
		const claudeProcess = spawn(
			"sh",
			["-c", `${this.config.claudePath} | jq -c .`],
			{
				cwd: workspaceDir,
				env: {
					...process.env,
					LINEAR_TOKEN: this.config.linearToken,
				},
			},
		);

		// Create Session object
		const session = new Session({
			issue,
			workspace,
			process: claudeProcess,
			startedAt: new Date(),
		});

		this.sessionManager.addSession(issue.id, session);

		// Emit status updates
		this.emit("session-started", {
			issueId: issue.id,
			identifier: issue.identifier,
			title: issue.title,
			isLive: true,
		});

		claudeProcess.on("exit", (code) => {
			const session = this.sessionManager.getSession(issue.id);
			if (session) {
				session.exitCode = code;
				session.exitedAt = new Date();
			}

			this.emit("session-ended", {
				issueId: issue.id,
				code,
				isLive: false,
			});
		});
	}

	private async handleComment(data: any): Promise<void> {
		const { issue, comment } = data;
		const session = this.sessionManager.getSession(issue.id);

		if (!session) {
			console.log("No active session for issue:", issue.id);
			return;
		}

		// In a real implementation, we would send the comment to Claude
		// For now, just log it
		console.log("New comment on", issue.identifier, ":", comment.body);
	}

	getActiveSessions(): Array<{ issueId: string; workspaceDir: string }> {
		return Array.from(this.sessionManager.getAllSessions().entries()).map(
			([issueId, session]) => ({
				issueId,
				workspaceDir: session.workspace.path,
			}),
		);
	}
}
