import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
	createWriteStream,
	type Dirent,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	type WriteStream,
	writeFileSync,
} from "node:fs";
import {
	basename,
	join,
	parse as pathParse,
	relative as pathRelative,
	resolve,
} from "node:path";
import { cwd } from "node:process";
import { createInterface } from "node:readline";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import { CursorMessageFormatter } from "./formatter.js";
import type {
	CursorJsonEvent,
	CursorRunnerConfig,
	CursorRunnerEvents,
	CursorSessionInfo,
} from "./types.js";

const CURSOR_MCP_CONFIG_DOCS_URL =
	"https://cursor.com/docs/context/mcp#configuration-locations";
const CURSOR_CLI_PERMISSIONS_DOCS_URL =
	"https://cursor.com/docs/cli/reference/permissions";

type ToolInput = Record<string, unknown>;

interface ParsedUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
}

interface ToolProjection {
	toolUseId: string;
	toolName: string;
	toolInput: ToolInput;
	result: string;
	isError: boolean;
}

interface CursorPermissionsConfig {
	permissions: {
		allow: string[];
		deny: string[];
	};
	[key: string]: unknown;
}

interface CursorPermissionsRestoreState {
	configPath: string;
	backupPath: string | null;
}

type CursorMcpServerConfig = Record<string, unknown>;

interface CursorMcpConfig {
	mcpServers: Record<string, CursorMcpServerConfig>;
	[key: string]: unknown;
}

interface CursorMcpRestoreState {
	configPath: string;
	backupPath: string | null;
}

type AcpRequestId = number;

interface AcpPendingRequest {
	method: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface AcpInitializeResult {
	protocolVersion?: number;
	agentCapabilities?: Record<string, unknown>;
	authMethods?: Array<Record<string, unknown>>;
}

type SDKSystemInitMessage = Extract<
	SDKMessage,
	{ type: "system"; subtype: "init" }
>;

function toFiniteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function createAssistantToolUseMessage(
	toolUseId: string,
	toolName: string,
	toolInput: ToolInput,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{
			type: "tool_use",
			id: toolUseId,
			name: toolName,
			input: toolInput,
		},
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		content: contentBlocks,
		model: "cursor-acp",
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		} as SDKAssistantMessage["message"]["usage"],
		container: null,
		context_management: null,
	};
}

function createUserToolResultMessage(
	toolUseId: string,
	result: string,
	isError: boolean,
): SDKUserMessage["message"] {
	const contentBlocks = [
		{
			type: "tool_result",
			tool_use_id: toolUseId,
			content: result,
			is_error: isError,
		},
	] as unknown as SDKUserMessage["message"]["content"];

	return {
		role: "user",
		content: contentBlocks,
	};
}

function createAssistantBetaMessage(
	content: string,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{ type: "text", text: content },
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		content: contentBlocks,
		model: "cursor-acp",
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		} as SDKAssistantMessage["message"]["usage"],
		container: null,
		context_management: null,
	};
}

function createResultUsage(parsed: ParsedUsage): SDKResultMessage["usage"] {
	return {
		input_tokens: parsed.inputTokens,
		output_tokens: parsed.outputTokens,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: parsed.cachedInputTokens,
		cache_creation: {
			ephemeral_1h_input_tokens: 0,
			ephemeral_5m_input_tokens: 0,
		},
	} as SDKResultMessage["usage"];
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Cursor execution failed";
}

function normalizeCursorModel(model?: string): string | undefined {
	if (!model) {
		return model;
	}

	// Preserve backward compatibility for selector aliases that Cursor CLI no longer accepts.
	if (model.toLowerCase() === "gpt-5") {
		return "auto";
	}

	return model;
}

function normalizeCursorExecutablePath(cursorPath?: string): string {
	if (!cursorPath) {
		return "agent";
	}

	const executableName = basename(cursorPath).toLowerCase();
	if (
		executableName === "cursor" ||
		executableName === "cursor.exe" ||
		executableName === "cursor.cmd"
	) {
		console.warn(
			`[CursorRunner] Ignoring Cursor wrapper path '${cursorPath}' for ACP mode; using 'agent' instead`,
		);
		return "agent";
	}

	return cursorPath;
}

function extractTextFromMessageContent(content: unknown): string {
	if (!Array.isArray(content)) {
		return "";
	}

	const text = content
		.map((block) => {
			if (!block || typeof block !== "object") {
				return "";
			}
			const blockObj = block as Record<string, unknown>;
			return getStringValue(blockObj, "text") || "";
		})
		.join("")
		.trim();

	return text;
}

function inferCommandToolName(command: string): string {
	const normalized = command.toLowerCase();
	if (/\brg\b|\bgrep\b/.test(normalized)) {
		return "Grep";
	}
	if (/\bglob\.glob\b|\bfind\b.+\s-name\s/.test(normalized)) {
		return "Glob";
	}
	if (/\bcat\b/.test(normalized) && !/>/.test(normalized)) {
		return "Read";
	}
	if (
		/<<\s*['"]?eof['"]?\s*>/i.test(command) ||
		/\becho\b.+>/.test(normalized)
	) {
		return "Write";
	}
	return "Bash";
}

function normalizeFilePath(path: string, workingDirectory?: string): string {
	if (!path) {
		return path;
	}

	if (workingDirectory && path.startsWith(workingDirectory)) {
		const relativePath = pathRelative(workingDirectory, path);
		if (relativePath && relativePath !== ".") {
			return relativePath;
		}
	}

	return path;
}

function summarizeFileChanges(
	item: Record<string, unknown>,
	workingDirectory?: string,
): string {
	const changes = Array.isArray(item.changes) ? item.changes : [];
	if (!changes.length) {
		return item.status === "failed" ? "Patch failed" : "No file changes";
	}

	return changes
		.map((change) => {
			if (!change || typeof change !== "object") {
				return null;
			}
			const mapped = change as Record<string, unknown>;
			const path = typeof mapped.path === "string" ? mapped.path : "";
			const kind = typeof mapped.kind === "string" ? mapped.kind : "update";
			const filePath = normalizeFilePath(path, workingDirectory);
			return `${kind} ${filePath}`;
		})
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

function isTodoCompleted(status: string): boolean {
	const s = status.toLowerCase();
	return s === "completed" || s === "todo_status_completed";
}

function isTodoInProgress(status: string): boolean {
	const s = status.toLowerCase();
	return s === "in_progress" || s === "todo_status_in_progress";
}

function summarizeTodoList(item: Record<string, unknown>): string {
	const todos = Array.isArray(item.items) ? item.items : [];
	if (!todos.length) {
		return "No todos";
	}

	return todos
		.map((todo) => {
			if (!todo || typeof todo !== "object") {
				return "- [ ] task";
			}
			const mapped = todo as Record<string, unknown>;
			const text =
				typeof mapped.content === "string"
					? mapped.content
					: typeof mapped.description === "string"
						? mapped.description
						: "task";
			const status =
				typeof mapped.status === "string"
					? mapped.status.toLowerCase()
					: "pending";
			const marker = isTodoCompleted(status) ? "[x]" : "[ ]";
			const suffix = isTodoInProgress(status) ? " (in progress)" : "";
			return `- ${marker} ${text}${suffix}`;
		})
		.join("\n");
}

function getStringValue(
	object: Record<string, unknown>,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = object[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
}

function parseToolPattern(
	toolPattern: string,
): { name: string; argument: string | null } | null {
	const trimmed = toolPattern.trim();
	if (!trimmed) {
		return null;
	}
	const match = trimmed.match(/^([A-Za-z]+)(?:\((.*)\))?$/);
	if (!match) {
		return null;
	}
	return {
		name: match[1] || "",
		argument: match[2]?.trim() ?? null,
	};
}

function normalizeShellCommandBase(argument: string | null): string {
	if (!argument || argument === "*" || argument === "**") {
		return "*";
	}
	const firstRule = argument.split(",")[0]?.trim();
	if (!firstRule) {
		return "*";
	}
	const beforeColon = firstRule.split(":")[0]?.trim();
	return beforeColon || "*";
}

function normalizePathPattern(argument: string | null): string {
	if (!argument) {
		// Keep file access scoped to workspace paths by default.
		return "./**";
	}
	const trimmed = argument.trim();
	if (!trimmed) {
		return "./**";
	}
	// Cursor treats broad globs as permissive; anchor wildcard defaults to workspace.
	if (trimmed === "**") {
		return "./**";
	}
	return trimmed;
}

function toCursorPath(path: string): string {
	return path.replace(/\\/g, "/");
}

function isWildcardPathArgument(argument: string | null): boolean {
	if (!argument) {
		return true;
	}
	const trimmed = argument.trim();
	return trimmed.length === 0 || trimmed === "**";
}

function isBroadReadToolPattern(toolPattern: string): boolean {
	const parsed = parseToolPattern(toolPattern);
	if (!parsed) {
		return false;
	}
	const toolName = parsed.name.toLowerCase();
	if (!(toolName === "read" || toolName === "glob" || toolName === "grep")) {
		return false;
	}
	return isWildcardPathArgument(parsed.argument);
}

function isBroadWriteToolPattern(toolPattern: string): boolean {
	const parsed = parseToolPattern(toolPattern);
	if (!parsed) {
		return false;
	}
	const toolName = parsed.name.toLowerCase();
	if (
		!(
			toolName === "edit" ||
			toolName === "write" ||
			toolName === "multiedit" ||
			toolName === "notebookedit" ||
			toolName === "todowrite"
		)
	) {
		return false;
	}
	return isWildcardPathArgument(parsed.argument);
}

function buildWorkspaceSiblingDenyPermissions(
	workspacePath: string,
	permission: "Read" | "Write",
): string[] {
	const resolvedWorkspacePath = resolve(workspacePath);
	const parsed = pathParse(resolvedWorkspacePath);
	if (!parsed.root) {
		return [];
	}

	const segments = resolvedWorkspacePath
		.slice(parsed.root.length)
		.split(/[\\/]+/)
		.filter(Boolean);
	if (segments.length === 0) {
		return [];
	}

	const denyPermissions = new Set<string>();
	let parentPath = parsed.root;

	for (const segment of segments) {
		let siblingEntries: Dirent[];
		try {
			siblingEntries = readdirSync(parentPath, { withFileTypes: true });
		} catch {
			break;
		}

		for (const sibling of siblingEntries) {
			if (!sibling.isDirectory() || sibling.name === segment) {
				continue;
			}
			const siblingPath = join(parentPath, sibling.name);
			denyPermissions.add(`${permission}(${toCursorPath(siblingPath)}/**)`);
		}

		parentPath = join(parentPath, segment);
	}

	return [...denyPermissions];
}

function buildSystemRootDenyPermissions(
	workspacePath: string,
	permission: "Read" | "Write",
): string[] {
	const workspace = toCursorPath(resolve(workspacePath));
	const rootCandidates = [
		"/etc",
		"/bin",
		"/sbin",
		"/usr",
		"/opt",
		"/System",
		"/Library",
		"/Applications",
		"/dev",
		"/proc",
		"/sys",
		"/Volumes",
		"/home",
	];

	const denies: string[] = [];
	for (const rootPath of rootCandidates) {
		if (workspace === rootPath || workspace.startsWith(`${rootPath}/`)) {
			continue;
		}
		denies.push(`${permission}(${rootPath}/**)`);
	}
	return denies;
}

function normalizeMcpPermissionPart(value: string | null): string {
	if (!value) {
		return "*";
	}
	const trimmed = value.trim();
	return trimmed || "*";
}

function mapClaudeMcpToolPatternToCursorPermission(
	toolPattern: string,
): string | null {
	const trimmed = toolPattern.trim();
	if (!trimmed.toLowerCase().startsWith("mcp__")) {
		return null;
	}

	const parts = trimmed.split("__");
	if (parts.length < 2) {
		return null;
	}

	const server = normalizeMcpPermissionPart(parts[1] || null);
	const tool =
		parts.length >= 3
			? normalizeMcpPermissionPart(parts.slice(2).join("__"))
			: "*";

	return `Mcp(${server}:${tool})`;
}

function mapClaudeToolPatternToCursorPermission(
	toolPattern: string,
): string | null {
	const mappedMcpPermission =
		mapClaudeMcpToolPatternToCursorPermission(toolPattern);
	if (mappedMcpPermission) {
		return mappedMcpPermission;
	}

	const parsed = parseToolPattern(toolPattern);
	if (!parsed) {
		return null;
	}

	const toolName = parsed.name.toLowerCase();
	if (toolName === "bash" || toolName === "shell") {
		return `Shell(${normalizeShellCommandBase(parsed.argument)})`;
	}
	if (toolName === "read" || toolName === "glob" || toolName === "grep") {
		return `Read(${normalizePathPattern(parsed.argument)})`;
	}
	if (
		toolName === "edit" ||
		toolName === "write" ||
		toolName === "multiedit" ||
		toolName === "notebookedit" ||
		toolName === "todowrite"
	) {
		return `Write(${normalizePathPattern(parsed.argument)})`;
	}

	return null;
}

function parseMcpServersFromCursorListOutput(output: string): string[] {
	const servers = new Set<string>();
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z0-9._-]+)\s*:/);
		const serverName = match?.[1]?.trim();
		if (serverName) {
			servers.add(serverName);
		}
	}
	return [...servers];
}

function getProjectionForItem(
	item: Record<string, unknown>,
	workingDirectory?: string,
): ToolProjection | null {
	const itemId = getStringValue(item, "id", "tool_id", "item_id");
	if (!itemId) {
		return null;
	}

	const itemType = getStringValue(item, "type");
	const status = getStringValue(item, "status") || "completed";
	const isError = status === "failed";

	if (itemType === "command_execution") {
		const command = getStringValue(item, "command") || "";
		const output = getStringValue(item, "aggregated_output", "output") || "";
		const exitCodeValue = item.exit_code;
		const exitCode = toFiniteNumber(exitCodeValue);
		const toolName = inferCommandToolName(command);
		const toolInput: ToolInput = {
			command,
			description: command,
		};
		const result =
			output ||
			(isError
				? `Command failed${exitCode ? ` (exit ${exitCode})` : ""}`
				: "Command completed");
		return {
			toolUseId: itemId,
			toolName,
			toolInput,
			result,
			isError,
		};
	}

	if (itemType === "file_change") {
		const summary = summarizeFileChanges(item, workingDirectory);
		return {
			toolUseId: itemId,
			toolName: "Edit",
			toolInput: { description: summary },
			result: summary,
			isError,
		};
	}

	if (itemType === "web_search") {
		const query = getStringValue(item, "query") || "web search";
		const actionValue = item.action;
		let toolInput: ToolInput = { query };
		let result = query;
		if (actionValue && typeof actionValue === "object") {
			const action = actionValue as Record<string, unknown>;
			const url = getStringValue(action, "url");
			if (url) {
				toolInput = { url };
				result = url;
			}
		}
		return {
			toolUseId: itemId,
			toolName: "WebSearch",
			toolInput,
			result,
			isError,
		};
	}

	if (itemType === "mcp_tool_call") {
		const server = getStringValue(item, "server") || "mcp";
		const tool = getStringValue(item, "tool") || "tool";
		const args =
			item.arguments && typeof item.arguments === "object"
				? item.arguments
				: {};
		const result =
			getStringValue(item, "result") ||
			safeStringify(item.result || "MCP tool completed");
		return {
			toolUseId: itemId,
			toolName: `mcp__${server}__${tool}`,
			toolInput: args as ToolInput,
			result,
			isError,
		};
	}

	if (itemType === "todo_list") {
		const summary = summarizeTodoList(item);
		return {
			toolUseId: itemId,
			toolName: "TodoWrite",
			toolInput: { todos: item.items },
			result: summary,
			isError,
		};
	}

	return null;
}

function extractToolResultFromPayload(payload: Record<string, unknown>): {
	text: string;
	isError: boolean;
} {
	const resultValue =
		payload.result && typeof payload.result === "object"
			? (payload.result as Record<string, unknown>)
			: null;
	if (!resultValue) {
		return { text: "Tool completed", isError: false };
	}

	if (resultValue.success && typeof resultValue.success === "object") {
		const success = resultValue.success as Record<string, unknown>;
		const output =
			getStringValue(
				success,
				"interleavedOutput",
				"stdout",
				"markdown",
				"text",
			) || safeStringify(success);
		return { text: output, isError: false };
	}

	const failure =
		resultValue.failure && typeof resultValue.failure === "object"
			? (resultValue.failure as Record<string, unknown>)
			: null;
	if (failure) {
		return {
			text:
				getStringValue(failure, "message", "stderr") || safeStringify(failure),
			isError: true,
		};
	}

	return { text: safeStringify(resultValue), isError: false };
}

function getProjectionForToolCallEvent(
	event: Record<string, unknown>,
	workingDirectory?: string,
): ToolProjection | null {
	const toolUseId = getStringValue(event, "call_id");
	if (!toolUseId) {
		return null;
	}

	const toolCallRaw =
		event.tool_call && typeof event.tool_call === "object"
			? (event.tool_call as Record<string, unknown>)
			: null;
	if (!toolCallRaw) {
		return null;
	}

	const variantKey = Object.keys(toolCallRaw)[0];
	if (!variantKey) {
		return null;
	}
	const payloadValue = toolCallRaw[variantKey];
	if (!payloadValue || typeof payloadValue !== "object") {
		return null;
	}
	const payload = payloadValue as Record<string, unknown>;
	const args =
		payload.args && typeof payload.args === "object"
			? (payload.args as Record<string, unknown>)
			: {};

	let toolName = "Tool";
	let toolInput: ToolInput = {};
	let resultText = "Tool completed";

	if (variantKey === "shellToolCall") {
		const command = getStringValue(args, "command") || "";
		toolName = inferCommandToolName(command);
		toolInput = { command, description: command };
	} else if (variantKey === "readToolCall") {
		toolName = "Read";
		toolInput = {
			path: normalizeFilePath(
				getStringValue(args, "path") || "",
				workingDirectory,
			),
			limit: args.limit,
		};
	} else if (variantKey === "grepToolCall") {
		toolName = "Grep";
		toolInput = {
			pattern: getStringValue(args, "pattern") || "",
			path: normalizeFilePath(
				getStringValue(args, "path") || "",
				workingDirectory,
			),
		};
	} else if (variantKey === "globToolCall") {
		toolName = "Glob";
		toolInput = {
			glob: getStringValue(args, "globPattern") || "",
			path: normalizeFilePath(
				getStringValue(args, "targetDirectory") || "",
				workingDirectory,
			),
		};
	} else if (variantKey === "editToolCall") {
		toolName = "Edit";
		toolInput = {
			path: normalizeFilePath(
				getStringValue(args, "path") || "",
				workingDirectory,
			),
		};
	} else if (variantKey === "deleteToolCall") {
		toolName = "Edit";
		toolInput = {
			description: `delete ${normalizeFilePath(getStringValue(args, "path") || "", workingDirectory)}`,
		};
	} else if (variantKey === "semSearchToolCall") {
		toolName = "ToolSearch";
		toolInput = { query: getStringValue(args, "query") || "" };
	} else if (variantKey === "readLintsToolCall") {
		toolName = "Read";
		toolInput = { paths: args.paths };
	} else if (variantKey === "mcpToolCall") {
		const provider = getStringValue(args, "providerIdentifier") || "mcp";
		const namedTool =
			getStringValue(args, "toolName") ||
			getStringValue(args, "name") ||
			"tool";
		toolName = `mcp__${provider}__${namedTool}`;
		toolInput =
			args.args && typeof args.args === "object"
				? (args.args as ToolInput)
				: {};
	} else if (variantKey === "listMcpResourcesToolCall") {
		toolName = "mcp__list_resources";
		toolInput = {};
	} else if (variantKey === "webFetchToolCall") {
		toolName = "WebFetch";
		toolInput = { url: getStringValue(args, "url") || "" };
	} else if (variantKey === "updateTodosToolCall") {
		toolName = "TodoWrite";
		toolInput = { todos: args.todos };
		resultText = summarizeTodoList({ items: args.todos });
	} else {
		toolName = variantKey.replace(/ToolCall$/, "");
		toolInput = args as ToolInput;
	}

	const extracted = extractToolResultFromPayload(payload);
	if (resultText === "Tool completed" || extracted.isError) {
		resultText = extracted.text;
	}

	return {
		toolUseId,
		toolName,
		toolInput,
		result: resultText,
		isError: extracted.isError,
	};
}

function extractUsageFromEvent(
	event: Record<string, unknown>,
): ParsedUsage | null {
	const usageRaw =
		event.usage && typeof event.usage === "object"
			? (event.usage as Record<string, unknown>)
			: null;
	if (!usageRaw) {
		return null;
	}
	return {
		inputTokens: toFiniteNumber(usageRaw.input_tokens),
		outputTokens: toFiniteNumber(usageRaw.output_tokens),
		cachedInputTokens: toFiniteNumber(usageRaw.cached_input_tokens),
	};
}

function extractUsageFromAcpResponse(
	response: Record<string, unknown>,
): ParsedUsage | null {
	const usageRaw =
		response.usage && typeof response.usage === "object"
			? (response.usage as Record<string, unknown>)
			: null;
	if (!usageRaw) {
		return null;
	}

	return {
		inputTokens: toFiniteNumber(usageRaw.inputTokens),
		outputTokens: toFiniteNumber(usageRaw.outputTokens),
		cachedInputTokens: toFiniteNumber(usageRaw.cachedReadTokens),
	};
}

function extractTextFromAcpContentBlock(content: unknown): string {
	if (!content || typeof content !== "object") {
		return "";
	}

	const contentObj = content as Record<string, unknown>;
	if (getStringValue(contentObj, "type") === "text") {
		return getStringValue(contentObj, "text") || "";
	}

	return "";
}

function summarizeAcpPlanEntries(plan: Record<string, unknown>): string {
	const entries = Array.isArray(plan.entries) ? plan.entries : [];
	if (!entries.length) {
		return "No todos";
	}

	return entries
		.map((entry) => {
			if (!entry || typeof entry !== "object") {
				return "- [ ] task";
			}

			const mapped = entry as Record<string, unknown>;
			const text = getStringValue(mapped, "content") || "task";
			const status = getStringValue(mapped, "status") || "pending";
			const marker = isTodoCompleted(status) ? "[x]" : "[ ]";
			const suffix = isTodoInProgress(status) ? " (in progress)" : "";
			return `- ${marker} ${text}${suffix}`;
		})
		.join("\n");
}

function extractTextFromAcpToolContent(content: unknown): string {
	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((item) => {
			if (!item || typeof item !== "object") {
				return "";
			}

			const itemObj = item as Record<string, unknown>;
			if (getStringValue(itemObj, "type") === "content") {
				return extractTextFromAcpContentBlock(itemObj.content);
			}

			if (getStringValue(itemObj, "type") === "diff") {
				const path = getStringValue(itemObj, "path", "newPath", "oldPath");
				if (path) {
					return `Updated ${path}`;
				}
			}

			if (getStringValue(itemObj, "type") === "terminal") {
				const terminalId = getStringValue(itemObj, "terminalId");
				return terminalId ? `terminal ${terminalId}` : "terminal";
			}

			return "";
		})
		.filter((value) => value.trim().length > 0)
		.join("\n")
		.trim();
}

function summarizeAcpToolLocations(
	locations: unknown,
	workingDirectory?: string,
): string {
	if (!Array.isArray(locations)) {
		return "";
	}

	return locations
		.map((location) => {
			if (!location || typeof location !== "object") {
				return "";
			}

			const locationObj = location as Record<string, unknown>;
			const path = getStringValue(locationObj, "path");
			if (!path) {
				return "";
			}

			return normalizeFilePath(path, workingDirectory);
		})
		.filter((value) => value.length > 0)
		.join("\n");
}

function getProjectionForAcpToolCall(
	toolCall: Record<string, unknown>,
	workingDirectory?: string,
): ToolProjection | null {
	const toolUseId = getStringValue(toolCall, "toolCallId");
	if (!toolUseId) {
		return null;
	}

	const rawInput =
		toolCall.rawInput && typeof toolCall.rawInput === "object"
			? (toolCall.rawInput as Record<string, unknown>)
			: null;
	const kind = getStringValue(toolCall, "kind") || "";
	const title = getStringValue(toolCall, "title") || "Tool";
	const locationsSummary = summarizeAcpToolLocations(
		toolCall.locations,
		workingDirectory,
	);
	const contentSummary = extractTextFromAcpToolContent(toolCall.content);
	const rawOutput = toolCall.rawOutput;
	const status = getStringValue(toolCall, "status") || "completed";

	let toolName = "Tool";
	let toolInput: ToolInput = {};

	if (
		rawInput &&
		(getStringValue(rawInput, "providerIdentifier") ||
			getStringValue(rawInput, "toolName", "name"))
	) {
		const provider = getStringValue(rawInput, "providerIdentifier") || "mcp";
		const namedTool = getStringValue(rawInput, "toolName", "name") || "tool";
		toolName = `mcp__${provider}__${namedTool}`;
		toolInput =
			rawInput.args && typeof rawInput.args === "object"
				? (rawInput.args as ToolInput)
				: (rawInput as ToolInput);
	} else if (kind === "execute") {
		const command = getStringValue(rawInput || {}, "command") || title;
		toolName = inferCommandToolName(command);
		toolInput = { command, description: command };
	} else if (kind === "read") {
		toolName = "Read";
		toolInput = locationsSummary
			? { paths: locationsSummary }
			: { description: title };
	} else if (kind === "search") {
		const query =
			getStringValue(rawInput || {}, "pattern", "query", "globPattern") ||
			title;
		toolName =
			getStringValue(rawInput || {}, "globPattern") || /glob/i.test(title)
				? "Glob"
				: /grep|rg/i.test(title)
					? "Grep"
					: "ToolSearch";
		toolInput = { query, description: title };
	} else if (kind === "edit" || kind === "move" || kind === "delete") {
		toolName = "Edit";
		toolInput = {
			description: locationsSummary || title,
		};
	} else if (kind === "fetch") {
		const url = getStringValue(rawInput || {}, "url");
		toolName =
			getStringValue(rawInput || {}, "query") || /search/i.test(title)
				? "WebSearch"
				: "WebFetch";
		toolInput = url ? { url } : { description: title };
	} else if (kind === "think") {
		toolName = "TodoWrite";
		toolInput = { description: title };
	} else {
		toolName = title.replace(/\s+/g, "_");
		toolInput = rawInput ? (rawInput as ToolInput) : { description: title };
	}

	let result = "";
	if (typeof rawOutput === "string") {
		result = rawOutput;
	} else if (rawOutput && typeof rawOutput === "object") {
		const rawOutputObj = rawOutput as Record<string, unknown>;
		result =
			getStringValue(
				rawOutputObj,
				"stdout",
				"stderr",
				"message",
				"output",
				"text",
			) || safeStringify(rawOutputObj);
	} else {
		result = contentSummary || locationsSummary || title;
	}

	if (!result) {
		result = status === "failed" ? `${title} failed` : `${title} completed`;
	}

	return {
		toolUseId,
		toolName,
		toolInput,
		result,
		isError: status === "failed",
	};
}

export declare interface CursorRunner {
	on<K extends keyof CursorRunnerEvents>(
		event: K,
		listener: CursorRunnerEvents[K],
	): this;
	emit<K extends keyof CursorRunnerEvents>(
		event: K,
		...args: Parameters<CursorRunnerEvents[K]>
	): boolean;
}

export class CursorRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = true;

	private config: CursorRunnerConfig;
	private sessionInfo: CursorSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;
	private process: ChildProcess | null = null;
	private readlineInterface: ReturnType<typeof createInterface> | null = null;
	private pendingResultMessage: SDKResultMessage | null = null;
	private hasInitMessage = false;
	private lastAssistantText: string | null = null;
	private wasStopped = false;
	private startTimestampMs = 0;
	private lastUsage: ParsedUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
	};
	private errorMessages: string[] = [];
	private emittedToolUseIds = new Set<string>();
	private fallbackOutputLines: string[] = [];
	private acpPendingRequests = new Map<AcpRequestId, AcpPendingRequest>();
	private acpNextRequestId = 1;
	private acpPromptCompleted = false;
	private acpToolCalls = new Map<string, Record<string, unknown>>();
	private pendingAssistantMessageId: string | null = null;
	private pendingAssistantText = "";
	private syntheticPlanUpdateCount = 0;
	private streamingMode = false;
	private pendingStreamMessages: string[] = [];
	private acpSessionId: string | null = null;
	private acpInitialized = false;
	private logStream: WriteStream | null = null;
	private mcpConfigRestoreState: CursorMcpRestoreState | null = null;
	private permissionsConfigRestoreState: CursorPermissionsRestoreState | null =
		null;

	constructor(config: CursorRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new CursorMessageFormatter();

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<CursorSessionInfo> {
		return this.startWithPrompt(prompt);
	}

	async startStreaming(initialPrompt?: string): Promise<CursorSessionInfo> {
		return this.startWithPrompt(null, initialPrompt);
	}

	addStreamMessage(content: string): void {
		if (!this.streamingMode || !this.isRunning()) {
			throw new Error("Cannot add stream message when not in streaming mode");
		}

		const normalized = content.trim();
		if (!normalized) {
			return;
		}

		this.pendingStreamMessages.push(normalized);
	}

	completeStream(): void {
		this.streamingMode = false;
	}

	private async startWithPrompt(
		stringPrompt?: string | null,
		streamingInitialPrompt?: string,
	): Promise<CursorSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Cursor session already running");
		}

		const sessionId = this.config.resumeSessionId || crypto.randomUUID();
		this.sessionInfo = {
			sessionId,
			startedAt: new Date(),
			isRunning: true,
		};

		this.messages = [];
		this.pendingResultMessage = null;
		this.hasInitMessage = false;
		this.lastAssistantText = null;
		this.wasStopped = false;
		this.startTimestampMs = Date.now();
		this.lastUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
		};
		this.errorMessages = [];
		this.emittedToolUseIds.clear();
		this.fallbackOutputLines = [];
		this.acpPendingRequests.clear();
		this.acpNextRequestId = 1;
		this.acpPromptCompleted = false;
		this.acpToolCalls.clear();
		this.pendingAssistantMessageId = null;
		this.pendingAssistantText = "";
		this.syntheticPlanUpdateCount = 0;
		this.streamingMode = stringPrompt == null;
		this.pendingStreamMessages = [];
		this.acpSessionId = null;
		this.acpInitialized = false;
		this.setupLogging(sessionId);
		this.syncProjectMcpConfig();
		this.enableCursorMcpServers();
		this.syncProjectPermissionsConfig();

		// Test/CI fallback: allow deterministic mock runs without launching Cursor ACP.
		if (process.env.CYRUS_CURSOR_MOCK === "1") {
			this.emitInitMessage();
			this.handleEvent({
				type: "message",
				role: "assistant",
				content: "Cursor mock session completed",
			});
			this.pendingResultMessage = this.createSuccessResultMessage(
				"Cursor mock session completed",
			);
			this.finalizeSession();
			return this.sessionInfo;
		}

		const prompt = (stringPrompt ?? streamingInitialPrompt ?? "").trim();
		const cursorPath = normalizeCursorExecutablePath(this.config.cursorPath);
		const args = this.buildArgs(prompt);
		const spawnLine = `[CursorRunner] Spawn: ${cursorPath} ${args.join(" ")}`;
		console.log(spawnLine);
		if (this.logStream) {
			this.logStream.write(`${spawnLine}\n`);
		}
		const child = spawn(cursorPath, args, {
			cwd: this.config.workingDirectory || cwd(),
			env: this.buildEnv(),
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process = child;

		child.on("close", (code) => {
			if (this.acpPromptCompleted || this.wasStopped) {
				return;
			}

			const message =
				code === null
					? "Cursor ACP process exited unexpectedly"
					: `Cursor ACP process exited with code ${code}`;
			this.rejectPendingAcpRequests(new Error(message));
		});
		child.on("error", (error) => {
			this.rejectPendingAcpRequests(
				error instanceof Error ? error : new Error(String(error)),
			);
		});

		this.readlineInterface = createInterface({
			input: child.stdout!,
			crlfDelay: Infinity,
		});

		this.readlineInterface.on("line", (line) => this.handleStdoutLine(line));

		child.stderr?.on("data", (data: Buffer) => {
			const text = data.toString().trim();
			if (!text) return;
			if (this.logStream) {
				this.logStream.write(`${text}\n`);
			}
		});

		let caughtError: unknown;
		try {
			await this.initializeAcpSession();

			const nextPrompt = prompt;
			if (nextPrompt) {
				await this.runAcpPrompt(nextPrompt);
			}

			while (this.streamingMode) {
				const queuedPrompt = await this.takeNextStreamMessage();
				if (!queuedPrompt) {
					break;
				}
				await this.runAcpPrompt(queuedPrompt);
			}
		} catch (error) {
			caughtError = error;
		} finally {
			this.finalizeSession(caughtError);
		}

		return this.sessionInfo;
	}

	private buildCursorPermissionsConfig(): CursorPermissionsConfig {
		// Cursor CLI permission tokens reference:
		// https://cursor.com/docs/cli/reference/permissions
		const allowedTools = this.config.allowedTools || [];
		const disallowedTools = this.config.disallowedTools || [];
		const workspacePath = this.config.workingDirectory;

		const allow = [
			...new Set(
				allowedTools
					.map(mapClaudeToolPatternToCursorPermission)
					.filter((value): value is string => Boolean(value)),
			),
		];
		const autoScopeDenyPermissions = new Set<string>();
		if (workspacePath) {
			if (allowedTools.some(isBroadReadToolPattern)) {
				for (const permission of buildWorkspaceSiblingDenyPermissions(
					workspacePath,
					"Read",
				)) {
					autoScopeDenyPermissions.add(permission);
				}
				for (const permission of buildSystemRootDenyPermissions(
					workspacePath,
					"Read",
				)) {
					autoScopeDenyPermissions.add(permission);
				}
			}
			if (allowedTools.some(isBroadWriteToolPattern)) {
				for (const permission of buildWorkspaceSiblingDenyPermissions(
					workspacePath,
					"Write",
				)) {
					autoScopeDenyPermissions.add(permission);
				}
				for (const permission of buildSystemRootDenyPermissions(
					workspacePath,
					"Write",
				)) {
					autoScopeDenyPermissions.add(permission);
				}
			}
		}

		const mappedDisallowedPermissions = disallowedTools
			.map(mapClaudeToolPatternToCursorPermission)
			.filter((value): value is string => Boolean(value));
		const deny = [
			...new Set(
				[...mappedDisallowedPermissions, ...autoScopeDenyPermissions].flat(),
			),
		];

		return {
			permissions: { allow, deny },
		};
	}

	private buildCursorMcpServersConfig(): Record<string, CursorMcpServerConfig> {
		const servers: Record<string, CursorMcpServerConfig> = {};
		for (const [serverName, rawConfig] of Object.entries(
			this.config.mcpConfig || {},
		)) {
			const configAny = rawConfig as Record<string, unknown>;
			if (
				typeof configAny.listTools === "function" ||
				typeof configAny.callTool === "function"
			) {
				console.warn(
					`[CursorRunner] Skipping MCP server '${serverName}' because in-process SDK server instances cannot be serialized to .cursor/mcp.json`,
				);
				continue;
			}

			const mapped: CursorMcpServerConfig = {};
			if (typeof configAny.command === "string") {
				mapped.command = configAny.command;
			}
			if (Array.isArray(configAny.args)) {
				mapped.args = configAny.args;
			}
			if (
				configAny.env &&
				typeof configAny.env === "object" &&
				!Array.isArray(configAny.env)
			) {
				mapped.env = configAny.env;
			}
			if (typeof configAny.cwd === "string") {
				mapped.cwd = configAny.cwd;
			}
			if (typeof configAny.url === "string") {
				mapped.url = configAny.url;
			}
			if (
				configAny.headers &&
				typeof configAny.headers === "object" &&
				!Array.isArray(configAny.headers)
			) {
				mapped.headers = configAny.headers;
			}
			if (typeof configAny.timeout === "number") {
				mapped.timeout = configAny.timeout;
			}

			if (!mapped.command && !mapped.url) {
				console.warn(
					`[CursorRunner] Skipping MCP server '${serverName}' because it has no serializable command/url transport`,
				);
				continue;
			}

			servers[serverName] = mapped;
		}

		return servers;
	}

	private syncProjectMcpConfig(): void {
		const workspacePath = this.config.workingDirectory;
		if (!workspacePath) {
			return;
		}

		const inlineServers = this.buildCursorMcpServersConfig();
		if (Object.keys(inlineServers).length === 0) {
			return;
		}

		const cursorDir = join(workspacePath, ".cursor");
		const configPath = join(cursorDir, "mcp.json");

		let existingConfig: CursorMcpConfig = { mcpServers: {} };
		try {
			if (existsSync(configPath)) {
				const parsed = JSON.parse(readFileSync(configPath, "utf8"));
				if (parsed && typeof parsed === "object") {
					existingConfig = parsed as CursorMcpConfig;
				}
			}
		} catch {
			// If existing config is malformed, overwrite with a valid mcpServers object.
		}

		const existingServers =
			existingConfig.mcpServers &&
			typeof existingConfig.mcpServers === "object" &&
			!Array.isArray(existingConfig.mcpServers)
				? (existingConfig.mcpServers as Record<string, CursorMcpServerConfig>)
				: {};

		const nextConfig: CursorMcpConfig = {
			...existingConfig,
			mcpServers: {
				...existingServers,
				...inlineServers,
			},
		};

		mkdirSync(cursorDir, { recursive: true });
		const backupPath = existsSync(configPath)
			? `${configPath}.cyrus-backup-${Date.now()}-${process.pid}`
			: null;

		try {
			if (backupPath) {
				renameSync(configPath, backupPath);
			}
			writeFileSync(
				configPath,
				`${JSON.stringify(nextConfig, null, "\t")}\n`,
				"utf8",
			);
			this.mcpConfigRestoreState = {
				configPath,
				backupPath,
			};
		} catch (error) {
			if (backupPath && existsSync(backupPath)) {
				try {
					renameSync(backupPath, configPath);
				} catch {
					// Best effort rollback; start() will surface the original failure.
				}
			}
			throw error;
		}

		console.log(
			`[CursorRunner] Synced project MCP servers at ${configPath} (servers=${Object.keys(nextConfig.mcpServers).length}, backup=${backupPath ? "yes" : "no"}; docs: ${CURSOR_MCP_CONFIG_DOCS_URL})`,
		);
	}

	private enableCursorMcpServers(): void {
		const workspacePath = this.config.workingDirectory;
		if (!workspacePath) {
			return;
		}

		const mcpCommand = process.env.CURSOR_MCP_COMMAND || "agent";
		const listResult = spawnSync(mcpCommand, ["mcp", "list"], {
			cwd: workspacePath,
			env: this.buildEnv(),
			encoding: "utf8",
		});

		if (
			(listResult.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
		) {
			console.warn(
				`[CursorRunner] Skipping MCP enable preflight: '${mcpCommand}' command not found`,
			);
			return;
		}

		const discoveredServers =
			(listResult.status ?? 1) === 0
				? parseMcpServersFromCursorListOutput(
						typeof listResult.stdout === "string" ? listResult.stdout : "",
					)
				: [];

		if ((listResult.status ?? 1) !== 0 && !listResult.error) {
			const detail =
				typeof listResult.stderr === "string" && listResult.stderr.trim()
					? listResult.stderr.trim()
					: `exit ${listResult.status ?? "unknown"}`;
			console.warn(
				`[CursorRunner] MCP list preflight failed: '${mcpCommand} mcp list' (${detail})`,
			);
		}

		// Cursor MCP enable preflight combines discovered servers and run-time inline config names.
		// MCP location/reference: https://cursor.com/docs/context/mcp#configuration-locations
		const inlineServers = Object.keys(this.config.mcpConfig || {});
		const allServers = [
			...new Set([...discoveredServers, ...inlineServers]),
		].sort((a, b) => a.localeCompare(b));

		for (const serverName of allServers) {
			const enableResult = spawnSync(
				mcpCommand,
				["mcp", "enable", serverName],
				{
					cwd: workspacePath,
					env: this.buildEnv(),
					encoding: "utf8",
				},
			);

			if (
				(enableResult.error as NodeJS.ErrnoException | undefined)?.code ===
				"ENOENT"
			) {
				console.warn(
					`[CursorRunner] Failed enabling MCP server '${serverName}': '${mcpCommand}' command not found`,
				);
				return;
			}

			if ((enableResult.status ?? 1) !== 0 || enableResult.error) {
				const detail = enableResult.error
					? enableResult.error.message
					: typeof enableResult.stderr === "string" &&
							enableResult.stderr.trim()
						? enableResult.stderr.trim()
						: `exit ${enableResult.status ?? "unknown"}`;
				console.warn(
					`[CursorRunner] Failed enabling MCP server '${serverName}' via '${mcpCommand} mcp enable ${serverName}': ${detail}`,
				);
				continue;
			}

			console.log(
				`[CursorRunner] Enabled MCP server '${serverName}' via '${mcpCommand} mcp enable ${serverName}'`,
			);
		}
	}

	private syncProjectPermissionsConfig(): void {
		const workspacePath = this.config.workingDirectory;
		if (!workspacePath) {
			return;
		}

		const mappedPermissions = this.buildCursorPermissionsConfig();

		const cursorDir = join(workspacePath, ".cursor");
		const configPath = join(cursorDir, "cli.json");

		let existingConfig: CursorPermissionsConfig = {
			permissions: { allow: [], deny: [] },
		};
		try {
			if (existsSync(configPath)) {
				const parsed = JSON.parse(readFileSync(configPath, "utf8"));
				if (parsed && typeof parsed === "object") {
					existingConfig = parsed as CursorPermissionsConfig;
				}
			}
		} catch {
			// If existing config is malformed, overwrite with a valid permissions object.
		}

		const nextConfig: CursorPermissionsConfig = {
			...existingConfig,
			permissions: mappedPermissions.permissions,
		};

		mkdirSync(cursorDir, { recursive: true });
		const backupPath = existsSync(configPath)
			? `${configPath}.cyrus-backup-${Date.now()}-${process.pid}`
			: null;

		try {
			if (backupPath) {
				renameSync(configPath, backupPath);
			}
			writeFileSync(
				configPath,
				`${JSON.stringify(nextConfig, null, "\t")}\n`,
				"utf8",
			);
			this.permissionsConfigRestoreState = {
				configPath,
				backupPath,
			};
		} catch (error) {
			if (backupPath && existsSync(backupPath)) {
				try {
					renameSync(backupPath, configPath);
				} catch {
					// Best effort rollback; start() will surface the original failure.
				}
			}
			throw error;
		}

		console.log(
			`[CursorRunner] Synced project permissions at ${configPath} (allow=${nextConfig.permissions.allow.length}, deny=${nextConfig.permissions.deny.length}, backup=${backupPath ? "yes" : "no"}; docs: ${CURSOR_CLI_PERMISSIONS_DOCS_URL})`,
		);
	}

	private restoreProjectPermissionsConfig(): void {
		const restoreState = this.permissionsConfigRestoreState;
		if (!restoreState) {
			return;
		}

		try {
			if (restoreState.backupPath) {
				if (existsSync(restoreState.configPath)) {
					unlinkSync(restoreState.configPath);
				}
				if (existsSync(restoreState.backupPath)) {
					renameSync(restoreState.backupPath, restoreState.configPath);
					console.log(
						`[CursorRunner] Restored original project permissions at ${restoreState.configPath}`,
					);
				}
				return;
			}

			if (existsSync(restoreState.configPath)) {
				unlinkSync(restoreState.configPath);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			console.warn(
				`[CursorRunner] Failed to restore project permissions config at ${restoreState.configPath}: ${detail}`,
			);
		} finally {
			this.permissionsConfigRestoreState = null;
		}
	}

	private restoreProjectMcpConfig(): void {
		const restoreState = this.mcpConfigRestoreState;
		if (!restoreState) {
			return;
		}

		try {
			if (restoreState.backupPath) {
				if (existsSync(restoreState.configPath)) {
					unlinkSync(restoreState.configPath);
				}
				if (existsSync(restoreState.backupPath)) {
					renameSync(restoreState.backupPath, restoreState.configPath);
					console.log(
						`[CursorRunner] Restored original project MCP config at ${restoreState.configPath}`,
					);
				}
				return;
			}

			if (existsSync(restoreState.configPath)) {
				unlinkSync(restoreState.configPath);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			console.warn(
				`[CursorRunner] Failed to restore project MCP config at ${restoreState.configPath}: ${detail}`,
			);
		} finally {
			this.mcpConfigRestoreState = null;
		}
	}

	private buildArgs(_prompt: string): string[] {
		const args: string[] = ["acp"];
		const normalizedModel = normalizeCursorModel(this.config.model);

		if (normalizedModel) {
			args.push("--model", normalizedModel);
		}

		if (this.config.sandbox) {
			args.push("--sandbox", this.config.sandbox);
		}

		if (this.config.approveMcps ?? true) {
			args.push("--approve-mcps");
		}

		// Trust avoids workspace prompts in headless ACP runs.
		args.push("--trust");

		return args;
	}

	private buildAcpMcpServers(): Record<string, unknown>[] {
		const servers: Record<string, unknown>[] = [];
		for (const [serverName, rawConfig] of Object.entries(
			this.config.mcpConfig || {},
		)) {
			const configAny = rawConfig as Record<string, unknown>;
			if (
				typeof configAny.listTools === "function" ||
				typeof configAny.callTool === "function"
			) {
				continue;
			}

			if (typeof configAny.command === "string") {
				const envEntries =
					configAny.env &&
					typeof configAny.env === "object" &&
					!Array.isArray(configAny.env)
						? Object.entries(configAny.env as Record<string, unknown>)
								.filter(([, value]) => typeof value === "string")
								.map(([name, value]) => ({ name, value }))
						: [];
				servers.push({
					name: serverName,
					command: configAny.command,
					args: Array.isArray(configAny.args)
						? configAny.args.filter(
								(value): value is string => typeof value === "string",
							)
						: [],
					env: envEntries,
				});
				continue;
			}

			if (typeof configAny.url === "string") {
				const headers =
					configAny.headers &&
					typeof configAny.headers === "object" &&
					!Array.isArray(configAny.headers)
						? Object.entries(configAny.headers as Record<string, unknown>)
								.filter(([, value]) => typeof value === "string")
								.map(([name, value]) => ({ name, value }))
						: [];
				servers.push({
					type: "http",
					name: serverName,
					url: configAny.url,
					headers,
				});
			}
		}

		return servers;
	}

	private async initializeAcpSession(): Promise<void> {
		if (this.acpInitialized) {
			return;
		}

		this.emitInitMessage();
		const initializeResult = await this.sendAcpRequest<AcpInitializeResult>(
			"initialize",
			{
				protocolVersion: 1,
				clientCapabilities: {
					fs: {
						readTextFile: false,
						writeTextFile: false,
					},
					terminal: false,
				},
				clientInfo: {
					name: "cyrus-cursor-runner",
					version: "0.1.0",
				},
			},
		);
		const hasCursorApiKey = Boolean(this.buildEnv().CURSOR_API_KEY);
		const authMethods = Array.isArray(initializeResult.authMethods)
			? initializeResult.authMethods
			: [];
		const supportsCursorLogin = authMethods.some(
			(method) => getStringValue(method, "id") === "cursor_login",
		);
		if (!hasCursorApiKey && supportsCursorLogin) {
			await this.sendAcpRequest("authenticate", { methodId: "cursor_login" });
		}

		const mcpServers = this.buildAcpMcpServers();
		const workingDirectory = this.config.workingDirectory || cwd();
		const sessionResponse = this.config.resumeSessionId
			? await this.sendAcpRequest<Record<string, unknown>>("session/load", {
					sessionId: this.config.resumeSessionId,
					cwd: workingDirectory,
					mcpServers,
				})
			: await this.sendAcpRequest<Record<string, unknown>>("session/new", {
					cwd: workingDirectory,
					mcpServers,
				});

		const sessionId =
			getStringValue(sessionResponse, "sessionId") ||
			this.config.resumeSessionId ||
			this.sessionInfo?.sessionId;
		if (sessionId && this.sessionInfo) {
			this.sessionInfo.sessionId = sessionId;
		}
		this.acpSessionId = sessionId || null;
		this.acpInitialized = true;
	}

	private async runAcpPrompt(prompt: string): Promise<void> {
		if (!prompt.trim()) {
			return;
		}

		this.acpPromptCompleted = false;

		const promptResponse = await this.sendAcpRequest<Record<string, unknown>>(
			"session/prompt",
			{
				sessionId:
					this.acpSessionId || this.sessionInfo?.sessionId || "pending",
				prompt: prompt ? [{ type: "text", text: prompt }] : [],
			},
		);

		this.acpPromptCompleted = true;
		this.flushPendingAssistantMessage();
		const usage = extractUsageFromAcpResponse(promptResponse);
		if (usage) {
			this.lastUsage = usage;
		}

		const stopReason = getStringValue(promptResponse, "stopReason");
		if (stopReason === "max_tokens" || stopReason === "max_turn_requests") {
			this.pendingResultMessage = this.createErrorResultMessage(
				`Cursor turn limit reached: ${stopReason}`,
			);
		}
	}

	private async takeNextStreamMessage(): Promise<string | null> {
		const immediate = this.pendingStreamMessages.shift();
		if (immediate) {
			return immediate;
		}

		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		return this.pendingStreamMessages.shift() ?? null;
	}

	private buildEnv(): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (this.config.cursorApiKey) {
			env.CURSOR_API_KEY = this.config.cursorApiKey;
		}
		return env;
	}

	private handleStdoutLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		if (this.logStream) {
			this.logStream.write(`${trimmed}\n`);
		}

		const parsed = this.parseJsonLine(trimmed);
		if (!parsed) {
			this.fallbackOutputLines.push(trimmed);
			return;
		}

		const jsonRpcHandled = this.handleJsonRpcMessage(
			parsed as Record<string, unknown>,
		);
		if (jsonRpcHandled) {
			return;
		}

		this.handleEvent(parsed);
	}

	private parseJsonLine(line: string): CursorJsonEvent | null {
		if (!(line.startsWith("{") || line.startsWith("["))) {
			return null;
		}
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== "object") {
				return null;
			}
			return parsed as CursorJsonEvent;
		} catch {
			return null;
		}
	}

	private sendAcpLine(payload: Record<string, unknown>): void {
		const encoded = JSON.stringify(payload);
		if (this.logStream) {
			this.logStream.write(`${encoded}\n`);
		}

		const stdin = this.process?.stdin;
		if (!stdin || stdin.destroyed || !stdin.writable) {
			throw new Error("Cursor ACP process is not writable");
		}

		stdin.write(`${encoded}\n`);
	}

	private sendAcpNotification(
		method: string,
		params: Record<string, unknown>,
	): void {
		this.sendAcpLine({
			jsonrpc: "2.0",
			method,
			params,
		});
	}

	private sendAcpRequest<T = unknown>(
		method: string,
		params: Record<string, unknown>,
	): Promise<T> {
		const id = this.acpNextRequestId++;
		return new Promise<T>((resolve, reject) => {
			this.acpPendingRequests.set(id, {
				method,
				resolve: (value) => resolve(value as T),
				reject,
			});

			try {
				this.sendAcpLine({
					jsonrpc: "2.0",
					id,
					method,
					params,
				});
			} catch (error) {
				this.acpPendingRequests.delete(id);
				reject(
					error instanceof Error ? error : new Error(normalizeError(error)),
				);
			}
		});
	}

	private rejectPendingAcpRequests(error: Error): void {
		for (const [id, pending] of this.acpPendingRequests) {
			this.acpPendingRequests.delete(id);
			pending.reject(error);
		}
	}

	private handleJsonRpcMessage(message: Record<string, unknown>): boolean {
		const method = getStringValue(message, "method");
		const idValue = message.id;
		const hasId =
			typeof idValue === "number" ||
			typeof idValue === "string" ||
			idValue === null;
		const result = message.result;
		const errorValue =
			message.error && typeof message.error === "object"
				? (message.error as Record<string, unknown>)
				: null;

		if (hasId && (result !== undefined || errorValue)) {
			const pending = this.acpPendingRequests.get(idValue as AcpRequestId);
			if (!pending) {
				return true;
			}

			this.acpPendingRequests.delete(idValue as AcpRequestId);
			if (errorValue) {
				const detail =
					getStringValue(errorValue, "message") ||
					getStringValue(
						errorValue.data as Record<string, unknown>,
						"message",
					) ||
					"Cursor ACP request failed";
				pending.reject(new Error(detail));
			} else {
				pending.resolve(result);
			}
			return true;
		}

		if (!method) {
			return false;
		}

		if (method === "session/update") {
			const params =
				message.params && typeof message.params === "object"
					? (message.params as Record<string, unknown>)
					: null;
			const update =
				params?.update && typeof params.update === "object"
					? (params.update as Record<string, unknown>)
					: null;
			if (update) {
				this.handleAcpSessionUpdate(update);
			}
			return true;
		}

		if (method === "session/request_permission" && hasId) {
			const params =
				message.params && typeof message.params === "object"
					? (message.params as Record<string, unknown>)
					: null;
			if (params) {
				void this.handleAcpPermissionRequest(idValue as AcpRequestId, params);
			}
			return true;
		}

		if (method === "cursor/update_todos") {
			const params =
				message.params && typeof message.params === "object"
					? (message.params as Record<string, unknown>)
					: null;
			if (params) {
				this.handleCursorTodosNotification(params);
			}
			return true;
		}

		return false;
	}

	private async handleAcpPermissionRequest(
		requestId: AcpRequestId,
		params: Record<string, unknown>,
	): Promise<void> {
		const toolCall =
			params.toolCall && typeof params.toolCall === "object"
				? (params.toolCall as Record<string, unknown>)
				: null;
		if (toolCall) {
			this.mergeAcpToolCall(toolCall);
			const projection = getProjectionForAcpToolCall(
				this.getMergedAcpToolCall(toolCall),
				this.config.workingDirectory,
			);
			if (projection) {
				this.flushPendingAssistantMessage();
				this.emitToolUse(projection);
			}
		}

		const options = Array.isArray(params.options) ? params.options : [];
		const selectedOption = this.selectPermissionOption(options);
		if (!selectedOption) {
			this.sendAcpLine({
				jsonrpc: "2.0",
				id: requestId,
				result: {
					outcome: {
						outcome: "cancelled",
					},
				},
			});
			return;
		}

		this.sendAcpLine({
			jsonrpc: "2.0",
			id: requestId,
			result: {
				outcome: {
					outcome: "selected",
					optionId: selectedOption,
				},
			},
		});
	}

	private selectPermissionOption(options: unknown[]): string | null {
		const mapped = options.filter(
			(option): option is Record<string, unknown> =>
				Boolean(option) && typeof option === "object",
		);
		if (!mapped.length) {
			return null;
		}

		const preferredKinds =
			this.config.askForApproval === "never"
				? ["allow_once", "allow_always"]
				: ["reject_once", "reject_always"];
		for (const kind of preferredKinds) {
			const match = mapped.find(
				(option) => getStringValue(option, "kind") === kind,
			);
			const optionId = getStringValue(match || {}, "optionId");
			if (optionId) {
				return optionId;
			}
		}

		return getStringValue(mapped[0] || {}, "optionId") || null;
	}

	private mergeAcpToolCall(toolCall: Record<string, unknown>): void {
		const toolCallId = getStringValue(toolCall, "toolCallId");
		if (!toolCallId) {
			return;
		}

		const existing = this.acpToolCalls.get(toolCallId) || {};
		this.acpToolCalls.set(toolCallId, {
			...existing,
			...toolCall,
		});
	}

	private getMergedAcpToolCall(
		toolCall: Record<string, unknown>,
	): Record<string, unknown> {
		const toolCallId = getStringValue(toolCall, "toolCallId");
		if (!toolCallId) {
			return toolCall;
		}

		return this.acpToolCalls.get(toolCallId) || toolCall;
	}

	private flushPendingAssistantMessage(): void {
		const content = this.pendingAssistantText.trim();
		if (!content) {
			this.pendingAssistantMessageId = null;
			this.pendingAssistantText = "";
			return;
		}

		this.handleMessageEvent({
			role: "assistant",
			content,
		});
		this.pendingAssistantMessageId = null;
		this.pendingAssistantText = "";
	}

	private handleAcpSessionUpdate(update: Record<string, unknown>): void {
		this.emit("streamEvent", update as CursorJsonEvent);

		const sessionUpdate = getStringValue(update, "sessionUpdate");
		if (!sessionUpdate) {
			return;
		}

		if (
			sessionUpdate === "agent_message_chunk" ||
			sessionUpdate === "user_message_chunk" ||
			sessionUpdate === "agent_thought_chunk"
		) {
			const text = extractTextFromAcpContentBlock(update.content);
			if (!text) {
				return;
			}

			if (sessionUpdate === "agent_message_chunk") {
				const messageId = getStringValue(update, "messageId") || null;
				if (
					this.pendingAssistantText &&
					this.pendingAssistantMessageId &&
					messageId &&
					this.pendingAssistantMessageId !== messageId
				) {
					this.flushPendingAssistantMessage();
				}

				this.pendingAssistantMessageId =
					messageId || this.pendingAssistantMessageId;
				this.pendingAssistantText += text;
			}

			return;
		}

		if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
			this.mergeAcpToolCall(update);
			const projection = getProjectionForAcpToolCall(
				this.getMergedAcpToolCall(update),
				this.config.workingDirectory,
			);
			if (!projection) {
				return;
			}

			this.flushPendingAssistantMessage();
			this.emitToolUse(projection);
			const status = getStringValue(update, "status");
			if (status === "completed" || status === "failed") {
				this.emitToolResult(projection);
			}
			return;
		}

		if (sessionUpdate === "plan") {
			this.flushPendingAssistantMessage();
			const projection: ToolProjection = {
				toolUseId: `plan-${++this.syntheticPlanUpdateCount}`,
				toolName: "TodoWrite",
				toolInput: { todos: update.entries },
				result: summarizeAcpPlanEntries(update),
				isError: false,
			};
			this.emitToolUse(projection);
			this.emitToolResult(projection);
			return;
		}

		if (sessionUpdate === "usage_update") {
			return;
		}
	}

	private handleCursorTodosNotification(params: Record<string, unknown>): void {
		const todos = Array.isArray(params.todos)
			? params.todos
			: Array.isArray(params.items)
				? params.items
				: [];
		if (!todos.length) {
			return;
		}

		const projection: ToolProjection = {
			toolUseId: `cursor-todos-${++this.syntheticPlanUpdateCount}`,
			toolName: "TodoWrite",
			toolInput: { todos },
			result: summarizeTodoList({ items: todos }),
			isError: false,
		};
		this.emitToolUse(projection);
		this.emitToolResult(projection);
	}

	private handleEvent(event: CursorJsonEvent): void {
		this.emit("streamEvent", event);

		const eventObj = event as Record<string, unknown>;
		const type = getStringValue(eventObj, "type");

		if (!type) {
			return;
		}

		if (
			type === "init" ||
			(type === "system" && getStringValue(eventObj, "subtype") === "init")
		) {
			const sessionId =
				getStringValue(eventObj, "session_id") || this.sessionInfo?.sessionId;
			if (sessionId && this.sessionInfo) {
				this.sessionInfo.sessionId = sessionId;
			}
			this.emitInitMessage();
			return;
		}

		if (type === "message") {
			this.emitInitMessage();
			this.handleMessageEvent(eventObj);
			return;
		}

		if (type === "assistant") {
			this.emitInitMessage();
			const messageObj = eventObj.message;
			const content =
				messageObj && typeof messageObj === "object"
					? extractTextFromMessageContent(
							(messageObj as Record<string, unknown>).content,
						)
					: "";
			if (content) {
				this.handleMessageEvent({
					role: "assistant",
					content,
				});
			}
			return;
		}

		if (type === "item.started" || type === "item.completed") {
			this.emitInitMessage();
			const item = eventObj.item;
			if (item && typeof item === "object") {
				this.handleItemEvent(type, item as Record<string, unknown>);
			}
			return;
		}

		if (type === "tool_call") {
			this.emitInitMessage();
			this.handleToolCallEvent(eventObj);
			return;
		}

		if (type === "turn.completed" || type === "result") {
			const usage = extractUsageFromEvent(eventObj);
			if (usage) {
				this.lastUsage = usage;
			}
			const stopReason = getStringValue(eventObj, "stop_reason");
			if (stopReason?.toLowerCase().includes("max")) {
				const result = this.createErrorResultMessage(
					`Cursor turn limit reached: ${stopReason}`,
				);
				this.pendingResultMessage = result;
			}
			return;
		}

		if (type === "error") {
			const message =
				getStringValue(eventObj, "message") || "Cursor execution failed";
			this.errorMessages.push(message);
			this.pendingResultMessage = this.createErrorResultMessage(message);
		}
	}

	private handleMessageEvent(event: Record<string, unknown>): void {
		const role = getStringValue(event, "role");
		const content = getStringValue(event, "content") || "";
		if (!content) {
			return;
		}

		if (role === "assistant") {
			this.lastAssistantText = content;
			const message: SDKAssistantMessage = {
				type: "assistant",
				message: createAssistantBetaMessage(content),
				parent_tool_use_id: null,
				uuid: crypto.randomUUID(),
				session_id: this.sessionInfo?.sessionId || "pending",
			};
			this.pushMessage(message);
			return;
		}

		if (role === "user") {
			const message: SDKUserMessage = {
				type: "user",
				message: {
					role: "user",
					content: [{ type: "text", text: content }],
				},
				parent_tool_use_id: null,
				session_id: this.sessionInfo?.sessionId || "pending",
			};
			this.pushMessage(message);
		}
	}

	private handleItemEvent(type: string, item: Record<string, unknown>): void {
		const projection = getProjectionForItem(item, this.config.workingDirectory);
		if (!projection) {
			return;
		}

		if (type === "item.started") {
			this.emitToolUse(projection);
			return;
		}

		this.emitToolUse(projection);
		this.emitToolResult(projection);
	}

	private handleToolCallEvent(event: Record<string, unknown>): void {
		const projection = getProjectionForToolCallEvent(
			event,
			this.config.workingDirectory,
		);
		if (!projection) {
			return;
		}

		const subtype = getStringValue(event, "subtype") || "started";
		if (subtype === "started") {
			this.emitToolUse(projection);
			return;
		}

		if (subtype === "completed" || subtype === "failed") {
			this.emitToolUse(projection);
			this.emitToolResult({
				...projection,
				isError: projection.isError || subtype === "failed",
			});
		}
	}

	private emitToolUse(projection: ToolProjection): void {
		if (this.emittedToolUseIds.has(projection.toolUseId)) {
			return;
		}
		this.emittedToolUseIds.add(projection.toolUseId);
		const message: SDKAssistantMessage = {
			type: "assistant",
			message: createAssistantToolUseMessage(
				projection.toolUseId,
				projection.toolName,
				projection.toolInput,
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private emitToolResult(projection: ToolProjection): void {
		const message: SDKUserMessage = {
			type: "user",
			message: createUserToolResultMessage(
				projection.toolUseId,
				projection.result,
				projection.isError,
			),
			parent_tool_use_id: projection.toolUseId,
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private emitInitMessage(): void {
		if (this.hasInitMessage) {
			return;
		}
		this.hasInitMessage = true;
		const sessionId = this.sessionInfo?.sessionId || crypto.randomUUID();
		const permissionModeByCursorConfig: Record<
			NonNullable<CursorRunnerConfig["askForApproval"]>,
			SDKSystemInitMessage["permissionMode"]
		> = {
			never: "dontAsk",
			"on-request": "default",
			"on-failure": "default",
			untrusted: "default",
		};
		const initMessage: SDKSystemInitMessage = {
			type: "system",
			subtype: "init",
			cwd: this.config.workingDirectory || cwd(),
			session_id: sessionId,
			tools: this.config.allowedTools || [],
			mcp_servers: [],
			model: this.config.model || "gpt-5",
			permissionMode: this.config.askForApproval
				? permissionModeByCursorConfig[this.config.askForApproval]
				: "default",
			apiKeySource: this.config.cursorApiKey ? "user" : "project",
			claude_code_version: "cursor-acp",
			slash_commands: [],
			output_style: "default",
			skills: [],
			plugins: [],
			uuid: crypto.randomUUID(),
			agents: undefined,
		};
		this.pushMessage(initMessage);
	}

	private createSuccessResultMessage(result: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "success",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: false,
			num_turns: 1,
			result,
			stop_reason: null,
			total_cost_usd: 0,
			usage: createResultUsage(this.lastUsage),
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private createErrorResultMessage(errorMessage: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "error_during_execution",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: true,
			num_turns: 1,
			errors: [errorMessage],
			stop_reason: null,
			total_cost_usd: 0,
			usage: createResultUsage(this.lastUsage),
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private pushMessage(message: SDKMessage): void {
		this.messages.push(message);
		this.emit("message", message);
	}

	private setupLogging(sessionId: string): void {
		try {
			const logsDir = join(this.config.cyrusHome, "logs");
			mkdirSync(logsDir, { recursive: true });
			this.logStream = createWriteStream(
				join(logsDir, `cursor-${sessionId}.jsonl`),
				{ flags: "a" },
			);
		} catch {
			this.logStream = null;
		}
	}

	private finalizeSession(error?: unknown): void {
		if (!this.sessionInfo) {
			return;
		}

		this.emitInitMessage();
		this.flushPendingAssistantMessage();
		this.sessionInfo.isRunning = false;
		this.restoreProjectMcpConfig();
		this.restoreProjectPermissionsConfig();

		let resultMessage: SDKResultMessage;
		if (this.pendingResultMessage) {
			resultMessage = this.pendingResultMessage;
		} else if (error || this.errorMessages.length > 0) {
			const message =
				normalizeError(error) ||
				this.errorMessages.at(-1) ||
				"Cursor execution failed";
			resultMessage = this.createErrorResultMessage(message);
		} else {
			const fallbackOutput = this.fallbackOutputLines.join("\n").trim();
			resultMessage = this.createSuccessResultMessage(
				this.lastAssistantText ||
					fallbackOutput ||
					"Cursor session completed successfully",
			);
		}

		this.pushMessage(resultMessage);
		this.emit("complete", [...this.messages]);

		if (error || this.errorMessages.length > 0) {
			const err =
				error instanceof Error
					? error
					: new Error(this.errorMessages.at(-1) || "Cursor execution failed");
			this.emit("error", err);
		}

		this.cleanupRuntimeState();
	}

	private cleanupRuntimeState(): void {
		this.rejectPendingAcpRequests(new Error("Cursor ACP session ended"));
		if (this.process && !this.process.killed) {
			this.process.kill();
		}
		if (this.readlineInterface) {
			this.readlineInterface.close();
			this.readlineInterface = null;
		}
		if (this.logStream) {
			this.logStream.end();
			this.logStream = null;
		}
		this.process = null;
		this.pendingResultMessage = null;
		this.streamingMode = false;
		this.pendingStreamMessages = [];
		this.acpSessionId = null;
		this.acpInitialized = false;
	}

	stop(): void {
		this.wasStopped = true;
		const sessionId = this.sessionInfo?.sessionId;
		if (this.process && sessionId) {
			try {
				this.sendAcpNotification("session/cancel", { sessionId });
			} catch {
				// Best effort cancellation before killing the ACP process.
			}
		}
		if (this.process && !this.process.killed) {
			this.process.kill();
		}
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}
	}

	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	getMessages(): SDKMessage[] {
		return [...this.messages];
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}
}
