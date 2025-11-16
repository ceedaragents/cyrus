import type { Activity, ActivityDisplayOptions } from "../types/index.js";
import { c } from "./colors.js";

/**
 * Pretty-print JSON with colors
 */
export function printJSON(obj: unknown, indent = 0): undefined | string {
	const spaces = "  ".repeat(indent);

	if (obj === null) return c.dim("null");
	if (obj === undefined) return c.dim("undefined");
	if (typeof obj === "string") return c.value(`"${obj}"`);
	if (typeof obj === "number") return c.value(String(obj));
	if (typeof obj === "boolean") return c.value(String(obj));

	if (Array.isArray(obj)) {
		if (obj.length === 0) return "[]";
		console.log("[");
		for (let i = 0; i < obj.length; i++) {
			process.stdout.write(`${spaces}  `);
			const value = printJSON(obj[i], indent + 1);
			if (typeof value === "string") process.stdout.write(value);
			console.log(i < obj.length - 1 ? "," : "");
		}
		console.log(`${spaces}]`);
		return;
	}

	if (typeof obj === "object") {
		const keys = Object.keys(obj);
		if (keys.length === 0) return "{}";
		console.log("{");
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			if (key !== undefined) {
				process.stdout.write(`${spaces}  ${c.info(key)}: `);
				const value = printJSON(
					(obj as Record<string, unknown>)[key],
					indent + 1,
				);
				if (typeof value === "string") process.stdout.write(value);
				console.log(i < keys.length - 1 ? "," : "");
			}
		}
		console.log(`${spaces}}`);
		return;
	}

	return String(obj);
}

/**
 * Display paginated activities with search
 */
export function displayActivities(
	activities: Activity[],
	options: ActivityDisplayOptions = {},
): void {
	const {
		limit = 20,
		offset = 0,
		search = "",
		full = false,
		previewLength = 200,
	} = options;

	// Filter by search term
	let filtered = activities;
	if (search) {
		const searchLower = search.toLowerCase();
		filtered = activities.filter((activity) => {
			const body = activity.content?.body || "";
			const type = activity.content?.type || "";
			return (
				body.toLowerCase().includes(searchLower) ||
				type.toLowerCase().includes(searchLower) ||
				activity.id.toLowerCase().includes(searchLower)
			);
		});
	}

	// Sort by most recent first
	const sorted = [...filtered].sort((a, b) => {
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});

	// Apply pagination
	const paginated = sorted.slice(offset, offset + limit);
	const total = sorted.length;

	console.log(
		c.bold(
			`\n📝 Activities (showing ${Math.min(limit, total - offset)} of ${total})`,
		),
	);

	if (search) {
		console.log(c.dim(`   Filtered by: "${search}"`));
	}

	if (offset > 0) {
		console.log(c.dim(`   Starting from: ${offset}`));
	}

	console.log();

	if (paginated.length === 0) {
		console.log(c.dim("   No activities found."));
		return;
	}

	for (let i = 0; i < paginated.length; i++) {
		const activity = paginated[i];
		if (!activity) continue;

		const num = offset + i + 1;
		const date = new Date(activity.createdAt).toLocaleString();
		const type = activity.content?.type || "unknown";
		const body = activity.content?.body || "";

		// Format signal badge with appropriate color
		let signalBadge = "";
		if (activity.signal) {
			const signalUpper = activity.signal.toUpperCase();
			switch (activity.signal.toLowerCase()) {
				case "auth":
					signalBadge = ` [${c.warning(signalUpper)}]`;
					break;
				case "select":
					signalBadge = ` [${c.info(signalUpper)}]`;
					break;
				case "continue":
					signalBadge = ` [${c.success(signalUpper)}]`;
					break;
				case "stop":
					signalBadge = ` [${c.error(signalUpper)}]`;
					break;
				default:
					signalBadge = ` [${c.dim(signalUpper)}]`;
			}
		}

		// Color-code activity types with emojis
		// Linear SDK defines 6 activity types: action, elicitation, error, prompt, response, thought
		let typeDisplay: string;
		switch (type) {
			case "thought":
				// Agent reasoning (model output)
				typeDisplay = `💭 ${c.info(type)}`;
				break;
			case "action":
				// Tool/action execution (model output)
				typeDisplay = `⚡ ${c.warning(type)}`;
				break;
			case "error":
				// Error messages (model output)
				typeDisplay = `❌ ${c.error(type)}`;
				break;
			case "prompt":
				// User input messages (USER INPUT - visually distinct)
				typeDisplay = `💬 ${c.success(type)}`;
				break;
			case "response":
				// Agent final responses (model output)
				typeDisplay = `✅ ${c.success(type)}`;
				break;
			case "elicitation":
				// Agent asking for input/choice (model output with signals)
				typeDisplay = `🤔 ${c.info(type)}`;
				break;
			default:
				typeDisplay = c.dim(type);
		}

		console.log(c.bold(`${num}. ${activity.id}`) + signalBadge);
		console.log(c.dim(`   ${date} • `) + typeDisplay);

		// Show signal metadata if present
		if (
			activity.signalMetadata &&
			Object.keys(activity.signalMetadata).length > 0
		) {
			const metadata = activity.signalMetadata;

			// Format common signal metadata types
			if (activity.signal === "auth" && "url" in metadata) {
				console.log(c.dim(`   Auth URL: ${c.info(String(metadata.url))}`));
			} else if (activity.signal === "select" && "options" in metadata) {
				console.log(
					c.dim(`   Options: ${c.info(JSON.stringify(metadata.options))}`),
				);
			} else {
				// Generic metadata display
				console.log(c.dim(`   Metadata: ${JSON.stringify(metadata)}`));
			}
		}

		// For action activities, show action details if available
		if (type === "action" && activity.content?.action) {
			const action = activity.content.action;
			const parameter = activity.content.parameter;
			let actionSummary = c.dim(`${action}`);

			// Try to extract useful info from parameter
			if (parameter) {
				if (typeof parameter === "string") {
					const preview =
						parameter.length > 50 ? `${parameter.slice(0, 50)}...` : parameter;
					actionSummary += c.dim(`: ${preview}`);
				} else if (
					typeof parameter === "object" &&
					parameter !== null &&
					"path" in parameter
				) {
					actionSummary += c.dim(`: ${parameter.path}`);
				} else if (
					typeof parameter === "object" &&
					parameter !== null &&
					"file_path" in parameter
				) {
					actionSummary += c.dim(`: ${parameter.file_path}`);
				} else if (
					typeof parameter === "object" &&
					parameter !== null &&
					"command" in parameter
				) {
					const cmd =
						typeof parameter.command === "string" &&
						parameter.command.length > 50
							? `${parameter.command.slice(0, 50)}...`
							: parameter.command;
					actionSummary += c.dim(`: ${cmd}`);
				}
			}

			console.log(`   ${actionSummary}`);
		} else if (body) {
			const displayBody = full
				? body
				: body.length > previewLength
					? `${body.slice(0, previewLength)}...`
					: body;
			console.log(`   ${displayBody.split("\n").join("\n   ")}`);
		}

		console.log();
	}

	// Show pagination hints
	if (offset + limit < total) {
		const nextOffset = offset + limit;
		console.log(
			c.dim(
				`→ More activities available. Use ${c.param(`--offset ${nextOffset}`)} to see next page.`,
			),
		);
	}

	if (offset > 0) {
		const prevOffset = Math.max(0, offset - limit);
		console.log(c.dim(`← Previous page: ${c.param(`--offset ${prevOffset}`)}`));
	}

	console.log();
}
