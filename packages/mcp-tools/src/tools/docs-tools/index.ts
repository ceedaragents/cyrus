import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DOCS_BUNDLE, type DocEntry } from "./docs-bundle.js";

/**
 * Tokenize text into lowercase words for search.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 1);
}

/**
 * Extract a relevant snippet from content around matching terms.
 */
function extractSnippet(
	content: string,
	terms: string[],
	maxLength = 300,
): string {
	const lower = content.toLowerCase();

	// Find the position of the first matching term
	let bestPos = -1;
	for (const term of terms) {
		const idx = lower.indexOf(term);
		if (idx !== -1 && (bestPos === -1 || idx < bestPos)) {
			bestPos = idx;
		}
	}

	if (bestPos === -1) {
		// No match in content, return start
		return (
			content.slice(0, maxLength) + (content.length > maxLength ? "..." : "")
		);
	}

	// Center the snippet around the match
	const start = Math.max(0, bestPos - 80);
	const end = Math.min(content.length, start + maxLength);
	let snippet = content.slice(start, end);

	if (start > 0) snippet = `...${snippet}`;
	if (end < content.length) snippet = `${snippet}...`;

	return snippet;
}

/**
 * Score a document against search terms.
 */
function scoreDoc(doc: DocEntry, terms: string[]): number {
	let score = 0;
	const titleLower = doc.title.toLowerCase();
	const slugLower = doc.slug.toLowerCase();
	const descLower = doc.description.toLowerCase();
	const contentLower = doc.content.toLowerCase();

	for (const term of terms) {
		// Title matches (highest weight)
		if (titleLower.includes(term)) score += 10;

		// Slug matches (high weight)
		if (slugLower.includes(term)) score += 8;

		// Description matches (medium weight)
		if (descLower.includes(term)) score += 5;

		// Content matches (lower weight, capped)
		const contentOccurrences = contentLower.split(term).length - 1;
		score += Math.min(contentOccurrences, 5) * 2;
	}

	return score;
}

/**
 * Register documentation tools on an existing McpServer instance.
 */
export function registerDocsTools(server: McpServer): void {
	server.registerTool(
		"search_docs",
		{
			description:
				"Search the Cyrus documentation for information about Cyrus capabilities, configuration, integrations, and workflows. Returns matching documentation pages ranked by relevance with content snippets.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Search query — keywords describing what you want to find (e.g. 'MCP servers setup', 'labels routing', 'security')",
					),
				limit: z
					.number()
					.optional()
					.describe(
						"Maximum number of results to return (default: 5, max: 20)",
					),
			},
		},
		async ({ query, limit = 5 }) => {
			const finalLimit = Math.min(Math.max(1, limit), 20);
			const terms = tokenize(query);

			if (terms.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: "Query must contain at least one searchable term",
							}),
						},
					],
				};
			}

			const results = DOCS_BUNDLE.map((doc) => ({
				doc,
				score: scoreDoc(doc, terms),
			}))
				.filter((r) => r.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, finalLimit);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								success: true,
								query,
								resultCount: results.length,
								results: results.map((r) => ({
									slug: r.doc.slug,
									title: r.doc.title,
									group: r.doc.group,
									description: r.doc.description,
									score: r.score,
									snippet: extractSnippet(r.doc.content, terms),
								})),
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"get_doc",
		{
			description:
				"Retrieve the full content of a specific Cyrus documentation page by its slug. Use search_docs first to find relevant page slugs.",
			inputSchema: {
				slug: z
					.string()
					.describe(
						"The documentation page slug (e.g. 'introduction', 'mcp-servers', 'integrations/slack')",
					),
			},
		},
		async ({ slug }) => {
			const doc = DOCS_BUNDLE.find((d) => d.slug === slug);

			if (!doc) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: `Document '${slug}' not found. Use search_docs or list_docs to find available pages.`,
								availableSlugs: DOCS_BUNDLE.map((d) => d.slug),
							}),
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								success: true,
								slug: doc.slug,
								title: doc.title,
								group: doc.group,
								description: doc.description,
								content: doc.content,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"list_docs",
		{
			description:
				"List all available Cyrus documentation pages, organized by section. Use this to discover what documentation is available before searching.",
			inputSchema: {},
		},
		async () => {
			// Group docs by their navigation group
			const groups = new Map<
				string,
				Array<{ slug: string; title: string; description: string }>
			>();

			for (const doc of DOCS_BUNDLE) {
				const group = groups.get(doc.group) || [];
				group.push({
					slug: doc.slug,
					title: doc.title,
					description: doc.description,
				});
				groups.set(doc.group, group);
			}

			const groupsArray = Array.from(groups.entries()).map(([name, pages]) => ({
				group: name,
				pages,
			}));

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								success: true,
								totalDocs: DOCS_BUNDLE.length,
								groups: groupsArray,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

/**
 * Create a standalone MCP server with only documentation tools.
 */
export function createCyrusDocsServer(): McpServer {
	const server = new McpServer({
		name: "cyrus-docs",
		version: "1.0.0",
	});

	registerDocsTools(server);
	return server;
}
