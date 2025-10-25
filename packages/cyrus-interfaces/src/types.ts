/**
 * Core supporting types for Cyrus I/O abstraction interfaces.
 * These types are used across multiple interfaces to provide consistent data structures.
 */

/**
 * Universal entity identifier type.
 * Used across all interfaces for consistent ID representation.
 */
export type EntityId = string;

/**
 * Represents the state of an issue in the tracking system.
 */
export interface IssueState {
	/** Unique identifier for the state */
	id: string;
	/** Display name of the state (e.g., "In Progress", "Completed") */
	name: string;
	/** Type classification of the state */
	type:
		| "triage"
		| "backlog"
		| "unstarted"
		| "started"
		| "completed"
		| "canceled";
	/** Color code for UI representation */
	color?: string;
	/** Position in the workflow */
	position?: number;
}

/**
 * Represents a user in the tracking system.
 */
export interface User {
	/** Unique identifier for the user */
	id: string;
	/** Display name of the user */
	name: string;
	/** Email address */
	email?: string;
	/** Avatar URL */
	avatarUrl?: string;
	/** Whether the user is active */
	active?: boolean;
}

/**
 * Represents a team in the tracking system.
 */
export interface Team {
	/** Unique identifier for the team */
	id: string;
	/** Team name */
	name: string;
	/** Team key/identifier (e.g., "ENG" for Engineering) */
	key: string;
	/** Team description */
	description?: string;
	/** Team icon */
	icon?: string;
}

/**
 * Represents a label that can be attached to issues.
 */
export interface Label {
	/** Unique identifier for the label */
	id: string;
	/** Label name */
	name: string;
	/** Label color */
	color?: string;
	/** Label description */
	description?: string;
}

/**
 * Represents a comment on an issue.
 */
export interface Comment {
	/** Unique identifier for the comment */
	id: string;
	/** Comment body (markdown) */
	body: string;
	/** User who created the comment */
	createdBy: User;
	/** Creation timestamp */
	createdAt: Date;
	/** Last update timestamp */
	updatedAt: Date;
	/** Parent comment ID if this is a reply */
	parentId?: string;
}

/**
 * Priority levels for issues.
 */
export enum IssuePriority {
	NoPriority = 0,
	Urgent = 1,
	High = 2,
	Normal = 3,
	Low = 4,
}

/**
 * Represents an issue in the tracking system.
 */
export interface Issue {
	/** Unique identifier */
	id: string;
	/** Human-readable identifier (e.g., "ENG-123") */
	identifier: string;
	/** Issue title */
	title: string;
	/** Issue description (markdown) */
	description?: string;
	/** Current state */
	state: IssueState;
	/** Priority level */
	priority: IssuePriority;
	/** Assigned user */
	assignee?: User;
	/** User who created the issue */
	createdBy: User;
	/** Team owning the issue */
	team: Team;
	/** Labels attached to the issue */
	labels: Label[];
	/** Creation timestamp */
	createdAt: Date;
	/** Last update timestamp */
	updatedAt: Date;
	/** Due date if set */
	dueDate?: Date;
	/** Parent issue ID if this is a sub-issue */
	parentId?: string;
	/** URL to view the issue */
	url: string;
	/** Git branch name associated with the issue */
	branchName?: string;
}

/**
 * Status of an agent session.
 */
export enum AgentSessionStatus {
	/** Session is active and processing */
	Active = "active",
	/** Session completed successfully */
	Completed = "completed",
	/** Session failed with an error */
	Failed = "failed",
	/** Session was canceled */
	Canceled = "canceled",
	/** Session is paused/waiting */
	Paused = "paused",
}

/**
 * Type of agent activity.
 */
export enum AgentActivityType {
	/** Thought or reasoning */
	Thought = "thought",
	/** Action being taken */
	Action = "action",
	/** Response to user */
	Response = "response",
	/** Error occurred */
	Error = "error",
	/** Elicitation or question */
	Elicitation = "elicitation",
}

/**
 * Represents an agent activity in a session.
 */
export interface AgentActivity {
	/** Unique identifier */
	id: string;
	/** Type of activity */
	type: AgentActivityType;
	/** Activity content */
	content: string;
	/** Timestamp */
	timestamp: Date;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Represents an agent session.
 */
export interface AgentSession {
	/** Unique identifier */
	id: string;
	/** Associated issue */
	issueId: string;
	/** Session status */
	status: AgentSessionStatus;
	/** Creation timestamp */
	createdAt: Date;
	/** Last update timestamp */
	updatedAt: Date;
	/** Activities in this session */
	activities: AgentActivity[];
	/** Session metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Represents a chat message in the system.
 */
export interface ChatMessage {
	/** Message role */
	role: "user" | "assistant" | "system";
	/** Message content */
	content: string;
	/** Timestamp */
	timestamp?: Date;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Configuration for chat execution.
 */
export interface ChatExecutionConfig {
	/** Working directory */
	workingDirectory: string;
	/** Environment variables */
	environment?: Record<string, string>;
	/** Additional arguments */
	args?: string[];
	/** Whether to continue from previous session */
	continue?: boolean;
	/** Timeout in milliseconds */
	timeout?: number;
}

/**
 * Result of a chat execution.
 */
export interface ChatExecutionResult {
	/** Whether execution was successful */
	success: boolean;
	/** Exit code */
	exitCode: number;
	/** Error message if failed */
	error?: string;
	/** Session ID */
	sessionId?: string;
}

/**
 * Represents a file system entry.
 */
export interface FileSystemEntry {
	/** Full path to the entry */
	path: string;
	/** Entry name */
	name: string;
	/** Whether this is a directory */
	isDirectory: boolean;
	/** Whether this is a file */
	isFile: boolean;
	/** File size in bytes */
	size?: number;
	/** Last modified timestamp */
	modifiedAt?: Date;
}

/**
 * Options for file operations.
 */
export interface FileOperationOptions {
	/** File encoding (default: 'utf-8') */
	encoding?: BufferEncoding;
	/** Whether to create parent directories */
	recursive?: boolean;
	/** File mode/permissions */
	mode?: number;
}

/**
 * Represents a Git commit.
 */
export interface GitCommit {
	/** Commit hash */
	hash: string;
	/** Commit message */
	message: string;
	/** Author information */
	author: {
		name: string;
		email: string;
	};
	/** Commit timestamp */
	timestamp: Date;
}

/**
 * Represents a Git branch.
 */
export interface GitBranch {
	/** Branch name */
	name: string;
	/** Whether this is the current branch */
	current: boolean;
	/** Commit hash */
	commit: string;
}

/**
 * Git operation options.
 */
export interface GitOperationOptions {
	/** Working directory */
	cwd?: string;
	/** Author name */
	authorName?: string;
	/** Author email */
	authorEmail?: string;
}

/**
 * HTTP request information.
 */
export interface HTTPRequest {
	/** HTTP method */
	method: string;
	/** Request path */
	path: string;
	/** Query parameters */
	query: Record<string, string | string[]>;
	/** Request headers */
	headers: Record<string, string | string[]>;
	/** Request body */
	body?: unknown;
	/** Raw body as string */
	rawBody?: string;
}

/**
 * HTTP response information.
 */
export interface HTTPResponse {
	/** Status code */
	statusCode: number;
	/** Response headers */
	headers: Record<string, string | string[]>;
	/** Response body */
	body?: unknown;
	/** Send response data */
	send: (data: unknown) => void;
	/** Send JSON response */
	json: (data: unknown) => void;
	/** Send status code */
	status: (code: number) => HTTPResponse;
}

/**
 * HTTP server configuration.
 */
export interface HTTPServerConfig {
	/** Port to listen on */
	port: number;
	/** Host to bind to */
	host?: string;
	/** Base path for routes */
	basePath?: string;
	/** Enable CORS */
	cors?: boolean;
	/** CORS origin */
	corsOrigin?: string | string[];
}

/**
 * HTTP route handler.
 */
export type HTTPRouteHandler = (
	request: HTTPRequest,
	response: HTTPResponse,
) => void | Promise<void>;

/**
 * HTTP middleware function.
 */
export type HTTPMiddleware = (
	request: HTTPRequest,
	response: HTTPResponse,
	next: () => void,
) => void | Promise<void>;

/**
 * Authentication credentials.
 */
export interface AuthCredentials {
	/** Credential type */
	type: "oauth" | "api_key" | "bearer" | "basic";
	/** Access token */
	accessToken?: string;
	/** Refresh token */
	refreshToken?: string;
	/** API key */
	apiKey?: string;
	/** Token expiration */
	expiresAt?: Date;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * OAuth flow information.
 */
export interface OAuthFlow {
	/** OAuth provider */
	provider: string;
	/** Authorization URL */
	authorizationUrl: string;
	/** Token URL */
	tokenUrl: string;
	/** Client ID */
	clientId: string;
	/** Client secret */
	clientSecret: string;
	/** Redirect URI */
	redirectUri: string;
	/** Scopes */
	scopes: string[];
}
