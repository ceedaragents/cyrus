import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CLIIssueTrackerService } from "cyrus-core";
import { z } from "zod";

/**
 * Create an SDK MCP server with basic issue tracker tools for CLI mode.
 * This replicates the 5 core tools from Linear's MCP server:
 * - create_comment
 * - create_issue
 * - get_issue
 * - list_labels
 * - list_teams
 */
export function createBasicIssueTrackerServer(
	issueTrackerService: CLIIssueTrackerService,
) {
	const createCommentTool = tool(
		"create_comment",
		"Create a comment on an issue",
		{
			issueId: z.string().describe("The ID of the issue"),
			body: z.string().describe("The comment body in markdown format"),
			parentId: z
				.string()
				.optional()
				.describe("Optional parent comment ID for replies"),
		},
		async ({ issueId, body, parentId }) => {
			try {
				const comment = await issueTrackerService.createComment(issueId, {
					body,
					...(parentId && { parentId }),
				});

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								comment: {
									id: comment.id,
									body: comment.body,
									createdAt: comment.createdAt,
								},
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const createIssueTool = tool(
		"create_issue",
		"Create a new issue",
		{
			title: z.string().describe("The issue title"),
			description: z
				.string()
				.optional()
				.describe("The issue description in markdown format"),
			teamId: z.string().optional().describe("The team ID"),
			parentId: z
				.string()
				.optional()
				.describe("Parent issue ID to create a sub-issue"),
		},
		async ({ title, description, teamId, parentId }) => {
			try {
				const issue = await issueTrackerService.createIssue({
					title,
					...(description && { description }),
					...(teamId && { teamId }),
					...(parentId && { parentId }),
				});

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								issue: {
									id: issue.id,
									identifier: issue.identifier,
									title: issue.title,
									url: issue.url,
								},
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const getIssueTool = tool(
		"get_issue",
		"Get details of a specific issue",
		{
			issueId: z
				.string()
				.describe("The issue ID or identifier (e.g., TEAM-123)"),
		},
		async ({ issueId }) => {
			try {
				const issue = await issueTrackerService.fetchIssue(issueId);

				if (!issue) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									success: false,
									error: `Issue ${issueId} not found`,
								}),
							},
						],
					};
				}

				// Handle state - it could be a Promise in the type system
				const state = issue.state instanceof Promise ? undefined : issue.state;
				const assignee =
					issue.assignee instanceof Promise ? undefined : issue.assignee;

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								issue: {
									id: issue.id,
									identifier: issue.identifier,
									title: issue.title,
									description: issue.description,
									state: state?.name || "Unknown",
									stateType: state?.type || null,
									assignee: assignee?.name || null,
									priority: issue.priority || 0,
									createdAt: issue.createdAt,
									updatedAt: issue.updatedAt,
									url: issue.url,
								},
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const listLabelsTool = tool(
		"list_labels",
		"List all available labels",
		{
			limit: z
				.number()
				.optional()
				.describe("Maximum number of labels to return (default: 50)"),
		},
		async ({ limit = 50 }) => {
			try {
				const result = await issueTrackerService.fetchLabels({
					first: Math.min(limit, 250),
				});

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								labels: result.nodes.map((label) => ({
									id: label.id,
									name: label.name,
									color: label.color,
								})),
								pageInfo: result.pageInfo,
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	const listTeamsTool = tool(
		"list_teams",
		"List all teams in the workspace",
		{
			limit: z
				.number()
				.optional()
				.describe("Maximum number of teams to return (default: 50)"),
		},
		async ({ limit = 50 }) => {
			try {
				const result = await issueTrackerService.fetchTeams({
					first: Math.min(limit, 250),
				});

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								teams: result.nodes.map((team) => ({
									id: team.id,
									name: team.name,
									key: team.key,
								})),
								pageInfo: result.pageInfo,
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		},
	);

	return createSdkMcpServer({
		name: "issue-tracker",
		version: "1.0.0",
		tools: [
			createCommentTool,
			createIssueTool,
			getIssueTool,
			listLabelsTool,
			listTeamsTool,
		],
	});
}
