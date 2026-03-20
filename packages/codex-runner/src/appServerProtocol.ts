export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

export interface JsonRpcSuccessResponse<Result = unknown> {
	id: number;
	result: Result;
}

export interface JsonRpcErrorResponse {
	id: number;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export type JsonRpcResponse<Result = unknown> =
	| JsonRpcSuccessResponse<Result>
	| JsonRpcErrorResponse;

export interface AppServerInitializeParams {
	clientInfo: {
		name: string;
		title: string;
		version: string;
	};
	capabilities: {
		experimentalApi: boolean;
		optOutNotificationMethods?: string[];
	} | null;
}

export type AppServerApprovalPolicy =
	| "never"
	| "on-request"
	| "on-failure"
	| "untrusted"
	| {
			reject: {
				sandbox_approval: boolean;
				rules: boolean;
				mcp_elicitations: boolean;
			};
	  };

export type AppServerReadOnlyAccess =
	| { type: "fullAccess" }
	| {
			type: "restricted";
			includePlatformDefaults: boolean;
			readableRoots: string[];
	  };

export type AppServerSandboxPolicy =
	| { type: "dangerFullAccess" }
	| { type: "externalSandbox"; networkAccess: "restricted" | "enabled" }
	| { type: "readOnly"; access: AppServerReadOnlyAccess }
	| {
			type: "workspaceWrite";
			writableRoots: string[];
			readOnlyAccess: AppServerReadOnlyAccess;
			networkAccess: boolean;
			excludeTmpdirEnvVar: boolean;
			excludeSlashTmp: boolean;
	  };

export interface AppServerThreadSummary {
	id: string;
	source?: string | null;
}

export interface AppServerThreadStartParams {
	model?: string | null;
	cwd?: string | null;
	approvalPolicy?: AppServerApprovalPolicy | null;
	sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
	config?: { [key: string]: JsonValue | undefined } | null;
	developerInstructions?: string | null;
	ephemeral?: boolean | null;
	experimentalRawEvents?: boolean;
	persistExtendedHistory?: boolean;
}

export interface AppServerThreadStartResponse {
	thread: AppServerThreadSummary;
}

export interface AppServerThreadResumeParams {
	threadId: string;
}

export interface AppServerTextInput {
	type: "text";
	text: string;
	text_elements: unknown[];
}

export interface AppServerLocalImageInput {
	type: "localImage";
	path: string;
}

export type AppServerUserInput = AppServerTextInput | AppServerLocalImageInput;

export interface AppServerTurnStartParams {
	threadId: string;
	input: AppServerUserInput[];
	cwd?: string | null;
	approvalPolicy?: AppServerApprovalPolicy | null;
	sandboxPolicy?: AppServerSandboxPolicy | null;
	model?: string | null;
	effort?: string | null;
	outputSchema?: JsonValue | null;
}

export interface AppServerTurnSummary {
	id: string;
	status: "completed" | "failed" | "interrupted" | "inProgress";
	error: { message: string } | null;
}

export interface AppServerTurnStartResponse {
	turn: AppServerTurnSummary;
}

export interface AppServerTurnInterruptParams {
	threadId: string;
}

export interface AppServerTokenUsage {
	total: {
		inputTokens: number;
		cachedInputTokens: number;
		outputTokens: number;
	};
	last: {
		inputTokens: number;
		cachedInputTokens: number;
		outputTokens: number;
	};
}

export interface AppServerCommandExecutionItem {
	type: "commandExecution";
	id: string;
	command: string;
	aggregatedOutput: string | null;
	exitCode: number | null;
	status: "in_progress" | "completed" | "failed" | "inProgress";
}

export interface AppServerFileChangeItem {
	type: "fileChange";
	id: string;
	status: "completed" | "failed";
	changes: Array<{ path: string; kind: "add" | "delete" | "update" }>;
}

export interface AppServerMcpToolCallItem {
	type: "mcpToolCall";
	id: string;
	server: string;
	tool: string;
	arguments: unknown;
	result: {
		content?: unknown[];
		structured_content?: unknown;
		structuredContent?: unknown;
	} | null;
	error: { message: string } | null;
	status: "in_progress" | "completed" | "failed" | "inProgress";
}

export interface AppServerAgentMessageItem {
	type: "agentMessage";
	id: string;
	text: string;
}

export interface AppServerReasoningItem {
	type: "reasoning";
	id: string;
	summary?: string[];
	content?: string[];
}

export interface AppServerWebSearchItem {
	type: "webSearch";
	id: string;
	query: string;
	action: {
		type?: string;
		url?: string;
		pattern?: string;
		query?: string;
		queries?: string[];
	} | null;
}

export interface AppServerPlanItem {
	type: "plan";
	id: string;
	text: string;
}

export type AppServerThreadItem =
	| AppServerCommandExecutionItem
	| AppServerFileChangeItem
	| AppServerMcpToolCallItem
	| AppServerAgentMessageItem
	| AppServerReasoningItem
	| AppServerWebSearchItem
	| AppServerPlanItem;

export type AppServerNotification =
	| {
			method: "thread/started";
			params: { thread: AppServerThreadSummary };
	  }
	| {
			method: "item/started";
			params: { threadId: string; turnId: string; item: AppServerThreadItem };
	  }
	| {
			method: "item/completed";
			params: { threadId: string; turnId: string; item: AppServerThreadItem };
	  }
	| {
			method: "turn/completed";
			params: { threadId: string; turn: AppServerTurnSummary };
	  }
	| {
			method: "turn/plan/updated";
			params: {
				threadId: string;
				turnId: string;
				explanation: string | null;
				plan: Array<{
					step: string;
					status: "pending" | "inProgress" | "completed";
				}>;
			};
	  }
	| {
			method: "thread/tokenUsage/updated";
			params: {
				threadId: string;
				turnId: string;
				tokenUsage: AppServerTokenUsage;
			};
	  }
	| {
			method: "error";
			params: { message: string };
	  }
	| {
			method: string;
			params?: unknown;
	  };

export type AppServerRequest =
	| {
			method: "item/tool/requestUserInput";
			id: number;
			params: {
				threadId: string;
				turnId: string;
				itemId: string;
				questions: Array<{
					id: string;
					header: string;
					question: string;
					isOther: boolean;
					isSecret: boolean;
					options: Array<{ label: string; description: string }> | null;
				}>;
			};
	  }
	| {
			method: "item/commandExecution/requestApproval";
			id: number;
			params: unknown;
	  }
	| {
			method: "item/fileChange/requestApproval";
			id: number;
			params: unknown;
	  }
	| {
			method: "item/tool/call";
			id: number;
			params: unknown;
	  }
	| {
			method: "applyPatchApproval";
			id: number;
			params: unknown;
	  }
	| {
			method: "execCommandApproval";
			id: number;
			params: unknown;
	  }
	| {
			method: string;
			id: number;
			params?: unknown;
	  };
