#!/usr/bin/env bun
/**
 * F1 - Fast CLI for Cyrus Platform Testing
 *
 * A modern TypeScript CLI tool for testing Cyrus agent platform.
 * Built with Bun and Commander.js.
 */

import { Command } from "commander";
import { createComment } from "./commands/comment.js";
import { getState } from "./commands/debug.js";
import { assignIssue, createIssue } from "./commands/issue.js";
import { ping } from "./commands/ping.js";
import {
	getActivity,
	promptSession,
	startSession,
	startSessionOnComment,
	stopSession,
	viewSession,
} from "./commands/session.js";
import { status, version } from "./commands/status.js";
import {
	createLabel,
	createMember,
	fetchLabels,
	fetchMembers,
} from "./commands/team.js";

const program = new Command();

program
	.name("f1")
	.description("F1 - Fast CLI for testing Cyrus agent platform")
	.version("1.0.0");

// Health & Status Commands
program
	.command("ping")
	.description("Check server connectivity")
	.action(async () => {
		await ping();
	});

program
	.command("status")
	.description("Get server status and version information")
	.action(async () => {
		await status();
	});

program
	.command("version")
	.description("Show server version")
	.action(async () => {
		await version();
	});

// Issue Management Commands
program
	.command("createIssue")
	.description("Create a new issue")
	.requiredOption("--title <title>", "Issue title")
	.option("--description <description>", "Issue description")
	.option("--assignee-id <assigneeId>", "User ID to assign the issue to")
	.option("--team-id <teamId>", "Team ID")
	.option("--state-id <stateId>", "Workflow state ID")
	.action(async (options) => {
		await createIssue({
			title: options.title,
			description: options.description,
			assigneeId: options.assigneeId,
			teamId: options.teamId,
			stateId: options.stateId,
		});
	});

program
	.command("assignIssue")
	.description("Assign an issue to a user or remove assignee")
	.requiredOption("--issue-id <issueId>", "Issue ID")
	.option("--assignee-id <assigneeId>", "User ID to assign (omit to unassign)")
	.action(async (options) => {
		await assignIssue({
			issueId: options.issueId,
			assigneeId: options.assigneeId,
		});
	});

// Comment Management Commands
program
	.command("createComment")
	.description("Create a comment on an issue")
	.requiredOption("--issue-id <issueId>", "Issue ID")
	.requiredOption("--body <body>", "Comment body text")
	.option("--mention-agent", "Mention the agent (triggers session)")
	.action(async (options) => {
		await createComment({
			issueId: options.issueId,
			body: options.body,
			mentionAgent: options.mentionAgent,
		});
	});

// Agent Session Commands
program
	.command("startSession")
	.description("Start an agent session on an issue")
	.requiredOption("--issue-id <issueId>", "Issue ID")
	.action(async (options) => {
		await startSession(options.issueId);
	});

program
	.command("startSessionOnComment")
	.description("Start an agent session on a root comment")
	.requiredOption("--comment-id <commentId>", "Comment ID")
	.action(async (options) => {
		await startSessionOnComment(options.commentId);
	});

program
	.command("viewSession")
	.description("View agent session details with pagination and search")
	.requiredOption("--session-id <sessionId>", "Session ID")
	.option("--limit <limit>", "Number of activities to show", "20")
	.option("--offset <offset>", "Starting offset for pagination", "0")
	.option("--search <search>", "Search term to filter activities")
	.option("--full", "Show complete activity bodies (no truncation)")
	.option(
		"--preview-length <previewLength>",
		"Characters to show in preview",
		"200",
	)
	.option("--summary", "Show final response summary prominently")
	.action(async (options) => {
		await viewSession({
			sessionId: options.sessionId,
			limit: Number.parseInt(options.limit, 10),
			offset: Number.parseInt(options.offset, 10),
			search: options.search,
			full: options.full,
			previewLength: Number.parseInt(options.previewLength, 10),
			summary: options.summary,
		});
	});

program
	.command("promptSession")
	.description("Send a prompt/message to an agent session")
	.requiredOption("--session-id <sessionId>", "Session ID")
	.requiredOption("--message <message>", "Message to send")
	.action(async (options) => {
		await promptSession({
			sessionId: options.sessionId,
			message: options.message,
		});
	});

program
	.command("stopSession")
	.description("Stop a running agent session")
	.requiredOption("--session-id <sessionId>", "Session ID")
	.action(async (options) => {
		await stopSession(options.sessionId);
	});

program
	.command("getActivity")
	.description("View a single activity's complete details")
	.requiredOption("--session-id <sessionId>", "Session ID")
	.requiredOption("--activity-id <activityId>", "Activity ID")
	.action(async (options) => {
		await getActivity({
			sessionId: options.sessionId,
			activityId: options.activityId,
		});
	});

// Team & Label Commands
program
	.command("fetchLabels")
	.description("List all labels in the workspace")
	.action(async () => {
		await fetchLabels();
	});

program
	.command("fetchMembers")
	.description("List all team members")
	.action(async () => {
		await fetchMembers();
	});

program
	.command("createLabel")
	.description("Create a new label")
	.requiredOption("--name <name>", "Label name")
	.option("--color <color>", "Label color (hex code, e.g., #ff0000)")
	.action(async (options) => {
		await createLabel({
			name: options.name,
			color: options.color,
		});
	});

program
	.command("createMember")
	.description("Create a new team member")
	.requiredOption("--name <name>", "Member name")
	.option("--email <email>", "Member email address")
	.action(async (options) => {
		await createMember({
			name: options.name,
			email: options.email,
		});
	});

// Debug Command
program
	.command("getState")
	.description("Get entire in-memory state (for debugging)")
	.action(async () => {
		await getState();
	});

// Parse arguments
program.parse();
