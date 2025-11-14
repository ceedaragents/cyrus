/**
 * RPC response structure
 */
export interface RPCResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * RPC request structure
 */
export interface RPCRequest {
	method: string;
	params?: Record<string, unknown>;
}

/**
 * Activity content structure
 */
export interface ActivityContent {
	type: string;
	body?: string;
	action?: string;
	parameter?: unknown;
}

/**
 * Activity structure
 */
export interface Activity {
	id: string;
	createdAt: string;
	content?: ActivityContent;
	signal?: string;
}

/**
 * Agent session structure
 */
export interface AgentSession {
	id: string;
	status: string;
	type: string;
	issueId: string;
	commentId?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Issue structure
 */
export interface Issue {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	teamId: string;
	stateId: string;
	assigneeId?: string;
}

/**
 * Server status structure
 */
export interface ServerStatus {
	version: string;
	platform: string;
	mode: string;
	uptime?: string;
}

/**
 * Options for pagination
 */
export interface PaginationOptions {
	limit?: number;
	offset?: number;
	search?: string;
	full?: boolean;
	previewLength?: number;
}

/**
 * Options for activity display
 */
export interface ActivityDisplayOptions extends PaginationOptions {
	summary?: boolean;
}

/**
 * RPC client options
 */
export interface RPCClientOptions {
	silent?: boolean;
}
