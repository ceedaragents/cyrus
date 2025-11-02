/**
 * Platform-agnostic interface for issue tracking platform operations.
 *
 * This interface provides a unified API for interacting with issue tracking
 * platforms like Linear, GitHub Issues, Jira, etc. It abstracts away platform-specific
 * details while supporting all operations needed for Cyrus agent functionality.
 *
 * @module issue-tracker/IIssueTrackerService
 */

import type {
	AgentEventTransportConfig,
	IAgentEventTransport,
} from "./IAgentEventTransport.js";
import type {
	AgentActivity,
	AgentActivityContent,
	AgentActivitySignal,
	AgentSession,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	AgentSessionCreateResponse,
	Comment,
	CommentCreateInput,
	CommentWithAttachments,
	Connection,
	FetchChildrenOptions,
	FileUploadRequest,
	FileUploadResponse,
	Issue,
	IssueUpdateInput,
	IssueWithChildren,
	Label,
	PaginationOptions,
	Team,
	User,
	WorkflowState,
} from "./types.js";

/**
 * Main interface for issue tracking platform operations.
 *
 * Implementations of this interface provide platform-specific logic for Linear,
 * GitHub, or other issue tracking systems while maintaining a consistent API.
 *
 * @remarks
 * This interface follows the Strategy pattern, allowing platform-specific
 * implementations to be swapped at runtime. The interface covers:
 *
 * - **Read Operations**: Fetching issues, comments, teams, labels, workflow states
 * - **Write Operations**: Creating/updating issues, comments, agent sessions, activities
 * - **File Operations**: Uploading files and getting asset URLs
 * - **Raw API Access**: Platform-specific GraphQL or REST API calls
 *
 * @example
 * Basic usage:
 * ```typescript
 * const service: IIssueTrackerService = createLinearService(config);
 *
 * // Fetch an issue
 * const issue = await service.fetchIssue('TEAM-123');
 *
 * // Create a comment
 * const comment = await service.createComment(issue.id, {
 *   body: 'This is a comment'
 * });
 *
 * // Create an agent session
 * const session = await service.createAgentSessionOnIssue({
 *   issueId: issue.id
 * });
 * ```
 *
 * @example
 * Advanced usage with async properties:
 * ```typescript
 * const issue = await service.fetchIssue('TEAM-123');
 *
 * // Access async properties
 * const state = await issue.state;
 * const assignee = await issue.assignee;
 * const team = await issue.team;
 *
 * console.log(`Issue ${issue.identifier} is ${state?.name}`);
 * ```
 */
export interface IIssueTrackerService {
	// ========================================================================
	// ISSUE OPERATIONS
	// ========================================================================

	/**
	 * Fetch a single issue by ID or identifier.
	 *
	 * @param idOrIdentifier - Issue ID (UUID) or identifier (e.g., "TEAM-123")
	 * @returns Promise resolving to the issue
	 * @throws Error if issue not found or request fails
	 *
	 * @example
	 * ```typescript
	 * // Fetch by identifier
	 * const issue = await service.fetchIssue('TEAM-123');
	 *
	 * // Fetch by UUID
	 * const issue = await service.fetchIssue('550e8400-e29b-41d4-a716-446655440000');
	 * ```
	 *
	 * @remarks
	 * The returned issue may have async properties (state, assignee, team).
	 * Access these properties using `await`:
	 * ```typescript
	 * const state = await issue.state;
	 * ```
	 */
	fetchIssue(idOrIdentifier: string): Promise<Issue>;

	/**
	 * Fetch child issues (sub-issues) for a parent issue.
	 *
	 * @param issueId - Parent issue ID or identifier
	 * @param options - Options for filtering and pagination
	 * @returns Promise resolving to issue with children
	 * @throws Error if parent issue not found or request fails
	 *
	 * @example
	 * ```typescript
	 * // Fetch all children
	 * const parent = await service.fetchIssueChildren('TEAM-123');
	 * console.log(`Found ${parent.childCount} children`);
	 *
	 * // Fetch only incomplete children
	 * const parent = await service.fetchIssueChildren('TEAM-123', {
	 *   includeCompleted: false,
	 *   limit: 50
	 * });
	 * ```
	 *
	 * @remarks
	 * Supports filtering by completion status and archive status.
	 * Use `limit` to control the number of children returned.
	 */
	fetchIssueChildren(
		issueId: string,
		options?: FetchChildrenOptions,
	): Promise<IssueWithChildren>;

	/**
	 * Update an issue's properties.
	 *
	 * @param issueId - Issue ID to update
	 * @param updates - Fields to update
	 * @returns Promise resolving to the updated issue
	 * @throws Error if issue not found or update fails
	 *
	 * @example
	 * ```typescript
	 * // Update issue state
	 * const updated = await service.updateIssue(issue.id, {
	 *   stateId: 'started-state-id'
	 * });
	 *
	 * // Update multiple fields
	 * const updated = await service.updateIssue(issue.id, {
	 *   title: 'New title',
	 *   assigneeId: 'user-id',
	 *   priority: IssuePriority.High
	 * });
	 * ```
	 *
	 * @remarks
	 * Only specified fields are updated. Omitted fields remain unchanged.
	 */
	updateIssue(issueId: string, updates: IssueUpdateInput): Promise<Issue>;

	/**
	 * Fetch attachments for an issue.
	 *
	 * @param issueId - Issue ID to fetch attachments for
	 * @returns Promise resolving to array of attachment metadata
	 * @throws Error if issue not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const attachments = await service.fetchIssueAttachments(issue.id);
	 * for (const attachment of attachments) {
	 *   console.log(`${attachment.title}: ${attachment.url}`);
	 * }
	 * ```
	 *
	 * @remarks
	 * - Linear platform: Returns attachments from Linear SDK
	 * - CLI platform: Returns empty array (no native attachments)
	 * - Attachments are typically external links (Sentry, Datadog, etc.)
	 */
	fetchIssueAttachments(
		issueId: string,
	): Promise<Array<{ title: string; url: string }>>;

	// ========================================================================
	// COMMENT OPERATIONS
	// ========================================================================

	/**
	 * Fetch comments for an issue with optional pagination.
	 *
	 * @param issueId - Issue ID to fetch comments for
	 * @param options - Pagination options
	 * @returns Promise resolving to connection of comments
	 * @throws Error if issue not found or request fails
	 *
	 * @example
	 * ```typescript
	 * // Fetch first 50 comments
	 * const comments = await service.fetchComments(issue.id, { first: 50 });
	 *
	 * // Fetch next page
	 * const nextPage = await service.fetchComments(issue.id, {
	 *   first: 50,
	 *   after: comments.pageInfo?.endCursor
	 * });
	 * ```
	 *
	 * @remarks
	 * Returns a connection object with `nodes` array and pagination info.
	 * Use cursor-based pagination with `after` and `before` parameters.
	 */
	fetchComments(
		issueId: string,
		options?: PaginationOptions,
	): Promise<Connection<Comment>>;

	/**
	 * Fetch a single comment by ID.
	 *
	 * @param commentId - Comment ID to fetch
	 * @returns Promise resolving to the comment
	 * @throws Error if comment not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const comment = await service.fetchComment('comment-id');
	 * console.log('Comment body:', comment.body);
	 * ```
	 *
	 * @remarks
	 * The returned comment may have async properties (user, parent).
	 * Access these using `await`:
	 * ```typescript
	 * const user = await comment.user;
	 * ```
	 */
	fetchComment(commentId: string): Promise<Comment>;

	/**
	 * Fetch a comment with attachments using raw GraphQL.
	 *
	 * @param commentId - Comment ID to fetch
	 * @returns Promise resolving to comment with attachments
	 * @throws Error if comment not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const comment = await service.fetchCommentWithAttachments('comment-id');
	 * comment.attachments?.forEach(att => {
	 *   console.log('Attachment:', att.filename, att.url);
	 * });
	 * ```
	 *
	 * @remarks
	 * This method uses raw GraphQL to fetch attachment metadata.
	 * Not all platforms may support this operation.
	 */
	fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments>;

	/**
	 * Create a comment on an issue.
	 *
	 * @param issueId - Issue ID to comment on
	 * @param input - Comment creation parameters
	 * @returns Promise resolving to the created comment
	 * @throws Error if issue not found or creation fails
	 *
	 * @example
	 * ```typescript
	 * // Create a root comment
	 * const comment = await service.createComment(issue.id, {
	 *   body: 'This is a comment'
	 * });
	 *
	 * // Create a reply comment
	 * const reply = await service.createComment(issue.id, {
	 *   body: 'This is a reply',
	 *   parentId: comment.id
	 * });
	 * ```
	 *
	 * @remarks
	 * Use `parentId` to create threaded replies to existing comments.
	 */
	createComment(issueId: string, input: CommentCreateInput): Promise<Comment>;

	// ========================================================================
	// TEAM OPERATIONS
	// ========================================================================

	/**
	 * Fetch all teams in the workspace/organization.
	 *
	 * @param options - Pagination options
	 * @returns Promise resolving to connection of teams
	 * @throws Error if request fails
	 *
	 * @example
	 * ```typescript
	 * const teams = await service.fetchTeams();
	 * teams.nodes.forEach(team => {
	 *   console.log(`Team ${team.key}: ${team.name}`);
	 * });
	 * ```
	 *
	 * @remarks
	 * Used for repository routing based on team keys.
	 */
	fetchTeams(options?: PaginationOptions): Promise<Connection<Team>>;

	/**
	 * Fetch a single team by ID or key.
	 *
	 * @param idOrKey - Team ID or key (e.g., "TEAM")
	 * @returns Promise resolving to the team
	 * @throws Error if team not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const team = await service.fetchTeam('TEAM');
	 * console.log('Team name:', team.name);
	 * ```
	 */
	fetchTeam(idOrKey: string): Promise<Team>;

	// ========================================================================
	// LABEL OPERATIONS
	// ========================================================================

	/**
	 * Fetch all issue labels in the workspace/organization.
	 *
	 * @param options - Pagination options
	 * @returns Promise resolving to connection of labels
	 * @throws Error if request fails
	 *
	 * @example
	 * ```typescript
	 * const labels = await service.fetchLabels();
	 * labels.nodes.forEach(label => {
	 *   console.log(`Label: ${label.name} (${label.color})`);
	 * });
	 * ```
	 *
	 * @remarks
	 * Used for repository routing based on label names.
	 */
	fetchLabels(options?: PaginationOptions): Promise<Connection<Label>>;

	/**
	 * Fetch a single label by ID or name.
	 *
	 * @param idOrName - Label ID or name
	 * @returns Promise resolving to the label
	 * @throws Error if label not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const label = await service.fetchLabel('bug');
	 * console.log('Label color:', label.color);
	 * ```
	 */
	fetchLabel(idOrName: string): Promise<Label>;

	// ========================================================================
	// WORKFLOW STATE OPERATIONS
	// ========================================================================

	/**
	 * Fetch workflow states for a team.
	 *
	 * @param teamId - Team ID to fetch states for
	 * @param options - Pagination options
	 * @returns Promise resolving to connection of workflow states
	 * @throws Error if team not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const states = await service.fetchWorkflowStates(team.id);
	 * const startedState = states.nodes.find(s => s.type === 'started');
	 * ```
	 *
	 * @remarks
	 * Used to find specific states like "started" for issue transitions.
	 */
	fetchWorkflowStates(
		teamId: string,
		options?: PaginationOptions,
	): Promise<Connection<WorkflowState>>;

	/**
	 * Fetch a single workflow state by ID.
	 *
	 * @param stateId - Workflow state ID
	 * @returns Promise resolving to the workflow state
	 * @throws Error if state not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const state = await service.fetchWorkflowState('state-id');
	 * console.log('State:', state.name, state.type);
	 * ```
	 */
	fetchWorkflowState(stateId: string): Promise<WorkflowState>;

	// ========================================================================
	// USER OPERATIONS
	// ========================================================================

	/**
	 * Fetch a user by ID.
	 *
	 * @param userId - User ID to fetch
	 * @returns Promise resolving to the user
	 * @throws Error if user not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const user = await service.fetchUser('user-id');
	 * console.log('User:', user.name, user.email);
	 * ```
	 */
	fetchUser(userId: string): Promise<User>;

	/**
	 * Fetch the current authenticated user.
	 *
	 * @returns Promise resolving to the current user
	 * @throws Error if request fails
	 *
	 * @example
	 * ```typescript
	 * const me = await service.fetchCurrentUser();
	 * console.log('Logged in as:', me.email);
	 * ```
	 */
	fetchCurrentUser(): Promise<User>;

	// ========================================================================
	// AGENT SESSION OPERATIONS
	// ========================================================================

	/**
	 * Create an agent session on an issue.
	 *
	 * @param input - Agent session creation parameters
	 * @returns Promise resolving to creation response
	 * @throws Error if issue not found or creation fails
	 *
	 * @example
	 * ```typescript
	 * const result = await service.createAgentSessionOnIssue({
	 *   issueId: 'TEAM-123',
	 *   externalLink: 'https://example.com/session/abc'
	 * });
	 * console.log('Created session:', result.agentSessionId);
	 * ```
	 *
	 * @remarks
	 * This creates a tracking session for AI/bot activity on an issue.
	 * The session can receive agent activities and user prompts.
	 */
	createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<AgentSessionCreateResponse>;

	/**
	 * Create an agent session on a comment thread.
	 *
	 * @param input - Agent session creation parameters
	 * @returns Promise resolving to creation response
	 * @throws Error if comment not found or creation fails
	 *
	 * @example
	 * ```typescript
	 * const result = await service.createAgentSessionOnComment({
	 *   commentId: 'comment-id',
	 *   externalLink: 'https://example.com/session/abc'
	 * });
	 * console.log('Created session:', result.agentSessionId);
	 * ```
	 *
	 * @remarks
	 * The comment must be a root comment (not a reply).
	 * This creates a tracking session for AI/bot activity on a comment thread.
	 */
	createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<AgentSessionCreateResponse>;

	/**
	 * Fetch an agent session by ID.
	 *
	 * @param sessionId - Agent session ID to fetch
	 * @returns Promise resolving to the agent session
	 * @throws Error if session not found or request fails
	 *
	 * @example
	 * ```typescript
	 * const session = await service.fetchAgentSession('session-id');
	 * console.log('Session status:', session.status);
	 * ```
	 */
	fetchAgentSession(sessionId: string): Promise<AgentSession>;

	// ========================================================================
	// AGENT ACTIVITY OPERATIONS
	// ========================================================================

	/**
	 * Post an agent activity to an agent session.
	 *
	 * Agent activities represent thoughts, observations, actions, responses,
	 * elicitations, and errors during agent execution.
	 *
	 * @param sessionId - Agent session ID to post activity to
	 * @param content - Activity content and type
	 * @param options - Optional activity options (ephemeral, signal, signalMetadata)
	 * @returns Promise resolving to the created activity
	 * @throws Error if session not found or creation fails
	 *
	 * @example
	 * ```typescript
	 * // Post a thought activity
	 * await service.createAgentActivity(sessionId, {
	 *   type: AgentActivityContentType.Thought,
	 *   body: 'I need to analyze the issue requirements'
	 * });
	 *
	 * // Post an ephemeral action activity (will be replaced by next activity)
	 * await service.createAgentActivity(sessionId, {
	 *   type: AgentActivityContentType.Action,
	 *   body: 'Running tests to verify the fix'
	 * }, { ephemeral: true });
	 *
	 * // Post a response activity with signal
	 * await service.createAgentActivity(sessionId, {
	 *   type: AgentActivityContentType.Response,
	 *   body: 'I have completed the requested changes'
	 * }, { signal: AgentActivitySignal.Stop });
	 * ```
	 *
	 * @remarks
	 * This is the primary method for posting agent updates to Linear.
	 * Activities are visible in the Linear UI as part of the agent session.
	 * Ephemeral activities disappear when replaced by the next activity.
	 */
	createAgentActivity(
		sessionId: string,
		content: AgentActivityContent,
		options?: {
			ephemeral?: boolean;
			signal?: AgentActivitySignal;
			signalMetadata?: Record<string, any>;
		},
	): Promise<AgentActivity>;

	// ========================================================================
	// FILE OPERATIONS
	// ========================================================================

	/**
	 * Request a file upload URL from the platform.
	 *
	 * @param request - File upload request parameters
	 * @returns Promise resolving to upload URL and asset URL
	 * @throws Error if request fails
	 *
	 * @example
	 * ```typescript
	 * // Request upload for an image
	 * const upload = await service.requestFileUpload({
	 *   contentType: 'image/png',
	 *   filename: 'screenshot.png',
	 *   size: 1024000,
	 *   makePublic: false
	 * });
	 *
	 * // Upload the file to the upload URL
	 * await fetch(upload.uploadUrl, {
	 *   method: 'PUT',
	 *   headers: upload.headers,
	 *   body: fileBuffer
	 * });
	 *
	 * // Use the asset URL in content
	 * const comment = await service.createComment(issue.id, {
	 *   body: `Screenshot: ${upload.assetUrl}`
	 * });
	 * ```
	 *
	 * @remarks
	 * This follows a two-step upload process:
	 * 1. Request upload URL from platform
	 * 2. Upload file to cloud storage using provided URL
	 * 3. Reference file using asset URL in content
	 */
	requestFileUpload(request: FileUploadRequest): Promise<FileUploadResponse>;

	// ========================================================================
	// PLATFORM METADATA
	// ========================================================================

	/**
	 * Get the platform type identifier.
	 *
	 * @returns Platform type (e.g., "linear", "github")
	 *
	 * @example
	 * ```typescript
	 * const platform = service.getPlatformType();
	 * console.log('Using platform:', platform);
	 * ```
	 */
	getPlatformType(): string;

	/**
	 * Get the platform's API version or other metadata.
	 *
	 * @returns Platform metadata
	 *
	 * @example
	 * ```typescript
	 * const metadata = service.getPlatformMetadata();
	 * console.log('API version:', metadata.apiVersion);
	 * ```
	 */
	getPlatformMetadata(): Record<string, unknown>;

	// ========================================================================
	// EVENT TRANSPORT
	// ========================================================================

	/**
	 * Create an event transport for receiving webhook events.
	 *
	 * This factory method creates a platform-specific transport that handles
	 * HTTP endpoints, authentication, and event delivery. The transport abstracts
	 * away platform-specific details like webhook signature verification.
	 *
	 * @param config - Transport configuration
	 * @returns Platform-specific event transport implementation
	 *
	 * @example
	 * ```typescript
	 * const transport = issueTracker.createEventTransport({
	 *   fastifyServer: server.getFastifyInstance(),
	 *   verificationMode: 'proxy',
	 *   secret: process.env.CYRUS_API_KEY
	 * });
	 *
	 * // Register HTTP endpoints
	 * transport.register();
	 *
	 * // Listen for events
	 * transport.on('event', (event: AgentEvent) => {
	 *   if (isAgentSessionCreatedEvent(event)) {
	 *     console.log('Session created:', event.agentSession.id);
	 *   }
	 * });
	 * ```
	 */
	createEventTransport(config: AgentEventTransportConfig): IAgentEventTransport;
}
