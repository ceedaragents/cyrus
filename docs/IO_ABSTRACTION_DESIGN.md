# Cyrus I/O Abstraction Design

## Executive Summary

This document defines a comprehensive I/O abstraction layer for Cyrus that decouples the core agent orchestration logic from specific implementations (Linear, Claude CLI, git, file systems). The design enables:

1. **Implementation Agnostic Testing** - Tests operate at interface boundaries with JSON/HTTP/stdin/stdout
2. **Multiple UI Implementations** - CLI, Web UI, Desktop App, or any issue tracking system
3. **Pluggable Components** - Swap Linear for Jira, Claude for other LLMs, git for other VCS
4. **Clean Architecture** - Domain logic isolated from infrastructure concerns

## Design Principles

### 1. Interface-First Design
Every I/O system is defined as a TypeScript interface before implementation. The interface represents the **essential operations** required by Cyrus's business logic.

### 2. Dependency Inversion
High-level orchestration logic depends on abstract interfaces, not concrete implementations. Implementations depend on and conform to interfaces.

### 3. Single Responsibility
Each interface represents one I/O concern:
- Issue tracking
- Chat execution
- Version control
- File operations
- Persistence
- Authentication

### 4. Testability
Interfaces designed for easy mocking and protocol-based testing (HTTP, JSON, process I/O).

---

## Core Abstractions

### 1. Issue Tracking System (ITS)

**Purpose:** Abstract all operations related to issue/task management, replacing direct Linear SDK usage.

```typescript
/**
 * Represents a task/issue in the tracking system.
 * Abstracted from Linear's Issue type to contain only essential fields.
 */
export interface Issue {
  id: string;
  identifier: string;  // Human-readable ID (e.g., "CYPACK-223")
  title: string;
  description: string;
  url: string;
  state: IssueState;
  assignee?: User;
  delegate?: User;  // For agent delegation
  team: Team;
  labels: Label[];
  attachments: Attachment[];
  parentId?: string;  // For sub-issues
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueState {
  id: string;
  name: string;
  type: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
}

export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface Team {
  id: string;
  name: string;
  key: string;  // Short identifier (e.g., "CYPACK")
}

export interface Label {
  id: string;
  name: string;
  color?: string;
}

export interface Attachment {
  id: string;
  title: string;
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * Represents a comment/activity on an issue.
 */
export interface Comment {
  id: string;
  issueId: string;
  body: string;
  createdAt: Date;
  createdBy: User;
  parentId?: string;  // For threaded comments
}

/**
 * Events emitted by the issue tracking system (webhooks).
 */
export type IssueEvent =
  | { type: 'issue.assigned'; issue: Issue; assignee: User }
  | { type: 'issue.unassigned'; issue: Issue; previousAssignee: User }
  | { type: 'issue.comment.created'; issue: Issue; comment: Comment }
  | { type: 'issue.comment.mention'; issue: Issue; comment: Comment; mentionedUser: User }
  | { type: 'session.created'; sessionId: string; issueId: string }
  | { type: 'session.prompted'; sessionId: string; issueId: string; prompt: string };

/**
 * Main interface for issue tracking operations.
 *
 * This interface abstracts Linear's API operations to support any issue tracking system.
 */
export interface IssueTrackingClient {
  /**
   * Subscribe to events from the issue tracking system.
   * Returns an unsubscribe function.
   */
  subscribe(handler: (event: IssueEvent) => void | Promise<void>): () => void;

  /**
   * Fetch full details of an issue by ID.
   */
  getIssue(issueId: string): Promise<Issue>;

  /**
   * Fetch child issues (sub-issues) for a parent issue.
   */
  getChildIssues(parentIssueId: string, options?: {
    includeCompleted?: boolean;
    includeArchived?: boolean;
  }): Promise<Issue[]>;

  /**
   * Update an issue's state.
   */
  updateIssueState(issueId: string, stateId: string): Promise<void>;

  /**
   * Update an issue's properties.
   */
  updateIssue(issueId: string, updates: Partial<Issue>): Promise<Issue>;

  /**
   * Create a new issue.
   */
  createIssue(data: {
    teamId: string;
    title: string;
    description?: string;
    assigneeId?: string;
    parentId?: string;
    labels?: string[];
    state?: string;
  }): Promise<Issue>;

  /**
   * Fetch comments for an issue.
   */
  getComments(issueId: string): Promise<Comment[]>;

  /**
   * Create a comment on an issue.
   */
  createComment(issueId: string, body: string, parentCommentId?: string): Promise<Comment>;

  /**
   * Get available states for a team.
   */
  getTeamStates(teamId: string): Promise<IssueState[]>;

  /**
   * Get teams accessible to the current user.
   */
  getTeams(): Promise<Team[]>;

  /**
   * Get the current authenticated user.
   */
  getCurrentUser(): Promise<User>;
}
```

**Implementations:**
- `LinearIssueTrackingClient` - Adapts Linear SDK to this interface
- `CLIIssueTrackingClient` - CLI-based mock implementation for testing
- `MemoryIssueTrackingClient` - In-memory implementation for unit tests

---

### 2. Agent Session Management

**Purpose:** Abstract the concept of agent work sessions, separate from Linear's Agent Activity concept.

```typescript
/**
 * Status of an agent session.
 */
export type AgentSessionStatus = 'pending' | 'active' | 'complete' | 'error' | 'canceled';

/**
 * Represents metadata about an agent session.
 */
export interface AgentSessionMetadata {
  model: string;
  tools: string[];
  totalCostUsd?: number;
  procedure?: {
    procedureName: string;
    currentSubroutineIndex: number;
    subroutineHistory: Array<{
      name: string;
      turns: number;
      outcome: 'success' | 'error' | 'interrupted';
    }>;
  };
}

/**
 * Represents an agent's work session.
 */
export interface AgentSession {
  id: string;  // Session ID
  issueId: string;  // Associated issue
  status: AgentSessionStatus;
  metadata: AgentSessionMetadata;
  chatSessionId?: string;  // ID from chat execution system
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Types of session activities that can be recorded.
 */
export type AgentActivityType = 'action' | 'response' | 'observation' | 'error';

/**
 * A single activity/entry in an agent session.
 */
export interface AgentActivity {
  id: string;
  sessionId: string;
  type: AgentActivityType;
  content: string;
  timestamp: Date;
  metadata?: {
    toolName?: string;
    toolStatus?: 'started' | 'completed' | 'failed';
    costUsd?: number;
  };
}

/**
 * Interface for managing agent sessions.
 *
 * This abstracts session tracking and activity recording from Linear's agent session concept.
 */
export interface AgentSessionManager {
  /**
   * Create a new agent session.
   */
  createSession(issueId: string, metadata: AgentSessionMetadata): Promise<AgentSession>;

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): Promise<AgentSession | null>;

  /**
   * Get all sessions for an issue.
   */
  getSessionsForIssue(issueId: string): Promise<AgentSession[]>;

  /**
   * Update session status.
   */
  updateSessionStatus(sessionId: string, status: AgentSessionStatus): Promise<void>;

  /**
   * Update session metadata.
   */
  updateSessionMetadata(sessionId: string, metadata: Partial<AgentSessionMetadata>): Promise<void>;

  /**
   * Record an activity in a session.
   */
  recordActivity(activity: Omit<AgentActivity, 'id' | 'timestamp'>): Promise<AgentActivity>;

  /**
   * Get all activities for a session.
   */
  getActivities(sessionId: string): Promise<AgentActivity[]>;

  /**
   * Link a chat session to an agent session.
   */
  linkChatSession(sessionId: string, chatSessionId: string): Promise<void>;
}
```

**Implementations:**
- `LinearAgentSessionManager` - Uses Linear's agent activity API
- `LocalAgentSessionManager` - File-based storage for CLI mode
- `MemoryAgentSessionManager` - In-memory for testing

---

### 3. Chat Execution System

**Purpose:** Abstract chat/LLM execution from Claude CLI specifics.

```typescript
/**
 * A message in a chat session.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    costUsd?: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: unknown;
  isError: boolean;
}

/**
 * Configuration for chat execution.
 */
export interface ChatExecutionConfig {
  model: string;
  systemPrompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  allowedDirectories?: string[];
  workingDirectory?: string;
  mcpServers?: MCPServerConfig[];
  loggingEnabled?: boolean;
  logDirectory?: string;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Events emitted during chat execution.
 */
export type ChatExecutionEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'tool.start'; toolCall: ToolCall }
  | { type: 'tool.complete'; toolResult: ToolResult }
  | { type: 'error'; error: Error }
  | { type: 'complete'; reason: 'finished' | 'max_turns' | 'stopped' | 'error' };

/**
 * Interface for executing chat sessions with an LLM.
 *
 * Abstracts Claude CLI execution to support any chat/LLM system.
 */
export interface ChatExecutor {
  /**
   * Start a new chat session.
   * Returns a session ID.
   */
  startSession(config: ChatExecutionConfig): Promise<string>;

  /**
   * Send a message to an active session.
   */
  sendMessage(sessionId: string, content: string): Promise<void>;

  /**
   * Subscribe to events from a session.
   * Returns an unsubscribe function.
   */
  subscribe(sessionId: string, handler: (event: ChatExecutionEvent) => void): () => void;

  /**
   * Stop a session.
   */
  stopSession(sessionId: string): Promise<void>;

  /**
   * Check if a session is active.
   */
  isSessionActive(sessionId: string): Promise<boolean>;

  /**
   * Get the message history for a session.
   */
  getMessageHistory(sessionId: string): Promise<ChatMessage[]>;
}
```

**Implementations:**
- `ClaudeChatExecutor` - Wraps existing ClaudeRunner
- `MockChatExecutor` - Returns predefined responses for testing
- `HTTPChatExecutor` - Connects to remote chat API

---

### 4. Version Control System (VCS)

**Purpose:** Abstract git operations to support alternative VCS or workspace management.

```typescript
/**
 * Represents a version-controlled workspace.
 */
export interface Workspace {
  id: string;
  path: string;
  branch: string;
  repositoryPath: string;  // Parent repository
  isWorktree: boolean;
}

/**
 * Interface for version control operations.
 *
 * Abstracts git to support any VCS.
 */
export interface VersionControlSystem {
  /**
   * Check if a directory is a valid repository.
   */
  isRepository(path: string): Promise<boolean>;

  /**
   * Create a workspace for an issue.
   * May create a git worktree or a simple directory copy.
   */
  createWorkspace(options: {
    repositoryPath: string;
    branch: string;
    workspacePath: string;
  }): Promise<Workspace>;

  /**
   * Delete a workspace.
   */
  deleteWorkspace(workspace: Workspace): Promise<void>;

  /**
   * Get the current branch of a workspace.
   */
  getCurrentBranch(workspacePath: string): Promise<string>;

  /**
   * List all workspaces for a repository.
   */
  listWorkspaces(repositoryPath: string): Promise<Workspace[]>;

  /**
   * Run a setup script in a workspace.
   */
  runSetupScript(workspace: Workspace, scriptPath: string): Promise<void>;
}
```

**Implementations:**
- `GitVCS` - Uses git worktrees and git commands
- `SimpleDirectoryVCS` - Just creates directories, no VCS
- `MockVCS` - In-memory for testing

---

### 5. File System Operations

**Purpose:** Abstract file I/O for configuration, logs, and persistence.

```typescript
/**
 * Interface for file system operations.
 *
 * Abstracts node:fs to support alternative storage backends.
 */
export interface FileSystem {
  /**
   * Read a file's contents.
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;

  /**
   * Write contents to a file.
   */
  writeFile(path: string, data: string | Buffer, options?: { encoding?: BufferEncoding }): Promise<void>;

  /**
   * Append to a file.
   */
  appendFile(path: string, data: string | Buffer): Promise<void>;

  /**
   * Check if a file exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Create a directory (recursive).
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Read directory contents.
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Delete a file.
   */
  unlink(path: string): Promise<void>;

  /**
   * Delete a directory (recursive).
   */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Get file stats.
   */
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: Date }>;

  /**
   * Create a writable stream.
   */
  createWriteStream(path: string, options?: { flags?: string }): NodeJS.WritableStream;
}
```

**Implementations:**
- `NodeFileSystem` - Wraps node:fs/promises
- `MemoryFileSystem` - In-memory for testing
- `RemoteFileSystem` - Could support S3, network storage, etc.

---

### 6. Persistence Layer

**Purpose:** Abstract session state persistence from file system specifics.

```typescript
/**
 * Represents the full state of the agent system.
 */
export interface AgentSystemState {
  sessions: Record<string, AgentSession>;
  activities: Record<string, AgentActivity[]>;  // sessionId -> activities
  sessionToIssue: Record<string, string>;  // sessionId -> issueId
  issueToSessions: Record<string, string[]>;  // issueId -> sessionIds
  childToParentSession: Record<string, string>;  // For hierarchical sessions
}

/**
 * Interface for persisting agent system state.
 *
 * Abstracts file-based persistence to support databases, cloud storage, etc.
 */
export interface PersistenceProvider {
  /**
   * Load the full agent system state.
   */
  loadState(): Promise<AgentSystemState>;

  /**
   * Save the full agent system state.
   */
  saveState(state: AgentSystemState): Promise<void>;

  /**
   * Save a single session.
   */
  saveSession(session: AgentSession): Promise<void>;

  /**
   * Load a single session.
   */
  loadSession(sessionId: string): Promise<AgentSession | null>;

  /**
   * Save activities for a session.
   */
  saveActivities(sessionId: string, activities: AgentActivity[]): Promise<void>;

  /**
   * Load activities for a session.
   */
  loadActivities(sessionId: string): Promise<AgentActivity[]>;
}
```

**Implementations:**
- `FilePersistenceProvider` - JSON files in ~/.cyrus/state
- `DatabasePersistenceProvider` - SQLite, PostgreSQL, etc.
- `MemoryPersistenceProvider` - Volatile, for testing

---

### 7. Authentication Provider

**Purpose:** Abstract OAuth and authentication flows.

```typescript
/**
 * Authentication credentials.
 */
export interface AuthCredentials {
  type: 'oauth' | 'api_key' | 'basic';
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: Date;
}

/**
 * Interface for authentication operations.
 *
 * Abstracts OAuth flows to support different providers and methods.
 */
export interface AuthProvider {
  /**
   * Check if currently authenticated.
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Get current credentials.
   */
  getCredentials(): Promise<AuthCredentials | null>;

  /**
   * Start OAuth flow.
   * Returns a URL to open in browser and waits for callback.
   */
  startOAuthFlow(options: {
    clientId: string;
    scopes: string[];
    redirectUri: string;
  }): Promise<AuthCredentials>;

  /**
   * Refresh expired credentials.
   */
  refreshCredentials(credentials: AuthCredentials): Promise<AuthCredentials>;

  /**
   * Clear stored credentials.
   */
  clearCredentials(): Promise<void>;

  /**
   * Store credentials.
   */
  storeCredentials(credentials: AuthCredentials): Promise<void>;
}
```

**Implementations:**
- `LinearOAuthProvider` - Linear OAuth flow
- `APIKeyAuthProvider` - Simple API key storage
- `MockAuthProvider` - Always authenticated for testing

---

### 8. HTTP Server Interface

**Purpose:** Abstract HTTP server for webhooks and callbacks.

```typescript
/**
 * HTTP request representation.
 */
export interface HTTPRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  query: Record<string, string>;
}

/**
 * HTTP response representation.
 */
export interface HTTPResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Route handler function.
 */
export type RouteHandler = (req: HTTPRequest) => Promise<HTTPResponse> | HTTPResponse;

/**
 * Interface for HTTP server operations.
 *
 * Abstracts node:http to support different server frameworks.
 */
export interface HTTPServer {
  /**
   * Start the server on a port.
   */
  start(port: number): Promise<void>;

  /**
   * Stop the server.
   */
  stop(): Promise<void>;

  /**
   * Register a route handler.
   */
  route(method: string, path: string, handler: RouteHandler): void;

  /**
   * Get the server's URL (including tunneling if configured).
   */
  getURL(): Promise<string>;

  /**
   * Check if server is running.
   */
  isRunning(): boolean;
}
```

**Implementations:**
- `NodeHTTPServer` - Uses node:http
- `ExpressHTTPServer` - Uses Express framework
- `MockHTTPServer` - In-memory for testing

---

## Package Structure

The abstractions will be organized into focused packages:

```
packages/
├── cyrus-interfaces/          # Core interface definitions
│   ├── src/
│   │   ├── IssueTrackingClient.ts
│   │   ├── AgentSessionManager.ts
│   │   ├── ChatExecutor.ts
│   │   ├── VersionControlSystem.ts
│   │   ├── FileSystem.ts
│   │   ├── PersistenceProvider.ts
│   │   ├── AuthProvider.ts
│   │   ├── HTTPServer.ts
│   │   └── index.ts
│   └── package.json
│
├── cyrus-adapters-linear/     # Linear implementations
│   ├── src/
│   │   ├── LinearIssueTrackingClient.ts
│   │   ├── LinearAgentSessionManager.ts
│   │   └── LinearOAuthProvider.ts
│   └── package.json
│
├── cyrus-adapters-claude/     # Claude implementations
│   ├── src/
│   │   └── ClaudeChatExecutor.ts
│   └── package.json
│
├── cyrus-adapters-local/      # Local/file-based implementations
│   ├── src/
│   │   ├── LocalAgentSessionManager.ts
│   │   ├── LocalPersistenceProvider.ts
│   │   ├── NodeFileSystem.ts
│   │   ├── GitVCS.ts
│   │   └── NodeHTTPServer.ts
│   └── package.json
│
├── cyrus-adapters-memory/     # In-memory implementations for testing
│   ├── src/
│   │   ├── MemoryIssueTrackingClient.ts
│   │   ├── MemoryAgentSessionManager.ts
│   │   ├── MemoryFileSystem.ts
│   │   ├── MockChatExecutor.ts
│   │   └── MockVCS.ts
│   └── package.json
│
├── cyrus-adapters-cli/        # CLI-based interface (user-facing)
│   ├── src/
│   │   ├── CLIIssueTrackingClient.ts  # Interactive CLI for issue management
│   │   ├── CLIRenderer.ts              # Renders agent activities to terminal
│   │   └── CLICommands.ts              # Command-line interface
│   └── package.json
│
├── cyrus-orchestrator/        # Core business logic (uses only interfaces)
│   ├── src/
│   │   ├── CyrusOrchestrator.ts       # Main orchestration logic
│   │   ├── IssueEventHandler.ts       # Handles issue events
│   │   ├── SessionLifecycleManager.ts # Manages session lifecycle
│   │   └── ProcedureExecutor.ts       # Executes multi-step procedures
│   └── package.json
│
└── cyrus-integration-tests/   # Protocol-based integration tests
    ├── src/
    │   ├── http-api.test.ts           # Test via HTTP API
    │   ├── cli-interface.test.ts      # Test via CLI
    │   └── fixtures/
    └── package.json
```

---

## Migration Strategy

### Phase 1: Create Interface Package
1. Create `packages/cyrus-interfaces` with all interface definitions
2. No implementations yet, just TypeScript interfaces
3. Add comprehensive JSDoc comments
4. Run `pnpm typecheck` to ensure clean compilation

### Phase 2: Create Adapter Packages
1. Create `packages/cyrus-adapters-linear` - wrap Linear SDK
2. Create `packages/cyrus-adapters-claude` - wrap ClaudeRunner
3. Create `packages/cyrus-adapters-local` - wrap file system, git, HTTP
4. Each adapter implements interfaces from `cyrus-interfaces`

### Phase 3: Create Memory Adapters for Testing
1. Create `packages/cyrus-adapters-memory` with mock implementations
2. Use these in existing unit tests
3. Ensure all existing tests still pass

### Phase 4: Create Orchestrator Package
1. Create `packages/cyrus-orchestrator` with core business logic
2. Extract orchestration code from `edge-worker` and `cli`
3. Use dependency injection - accept interface implementations
4. No direct imports of Linear SDK or ClaudeRunner

### Phase 5: Refactor Existing Applications
1. Update `apps/cli` to use orchestrator with adapters
2. Update `packages/edge-worker` to use orchestrator
3. Remove direct SDK usage, route through adapters

### Phase 6: Create CLI Interface
1. Create `packages/cyrus-adapters-cli` with terminal-based interface
2. Interactive prompts for issue management
3. Rich terminal rendering of agent activities
4. Demonstrate Cyrus working without Linear

### Phase 7: Integration Tests
1. Create `packages/cyrus-integration-tests`
2. Test via HTTP API (protocol-based)
3. Test via CLI stdin/stdout
4. Test with mock adapters and real adapters
5. Demonstrate language-agnostic testing capability

---

## CLI Interface Design

The CLI interface will provide a terminal-based experience that mirrors Linear's capabilities:

### Commands

```bash
# Initialize Cyrus CLI mode
cyrus init --mode=cli --workspace=./my-project

# List issues
cyrus issues list
cyrus issues list --team=backend --state=started

# Create issue
cyrus issues create --title="Fix login bug" --description="Users cannot log in"

# View issue
cyrus issues view CYRUS-123

# Assign issue to Cyrus agent
cyrus issues assign CYRUS-123 --to=cyrus

# View agent session activities (live streaming)
cyrus sessions watch CYRUS-123

# Add comment to issue
cyrus issues comment CYRUS-123 --message="Please also check the cache"

# View all sessions
cyrus sessions list

# Export issue data
cyrus export --format=json --output=./backup.json
```

### Terminal UI

The CLI interface will use rich terminal formatting:

- **Issue List**: Table with columns (ID, Title, State, Assignee)
- **Issue View**: Formatted issue details with description, metadata, comments
- **Session Watch**: Live-streaming agent activities with color coding:
  - Blue: User messages
  - Green: Agent responses
  - Yellow: Tool executions
  - Red: Errors
- **Interactive Prompts**: Use `inquirer` or similar for interactive flows

### Storage

CLI mode will store data in `~/.cyrus/cli-workspace/`:
- `issues.json` - All issues
- `sessions.json` - All agent sessions
- `activities.json` - All session activities

---

## Testing Strategy

### Unit Tests
- Test each adapter independently with mocks
- Test interfaces with memory implementations
- Test orchestrator with memory adapters

### Integration Tests (Protocol-Based)

**HTTP API Testing:**
```typescript
// Start Cyrus with HTTP interface
const server = await startCyrusHTTPServer({
  port: 3000,
  adapters: memoryAdapters,
});

// Test issue creation via HTTP
const response = await fetch('http://localhost:3000/api/issues', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Test issue',
    description: 'Description',
    teamId: 'team-123',
  }),
});

expect(response.status).toBe(201);
const issue = await response.json();
expect(issue.title).toBe('Test issue');
```

**CLI Testing:**
```typescript
// Spawn Cyrus CLI process
const proc = spawn('cyrus', ['issues', 'create', '--title=Test'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Send input via stdin
proc.stdin.write('Description\n');

// Read output from stdout
const output = await readStream(proc.stdout);
expect(output).toContain('Created issue CYRUS-');
```

**Language-Agnostic Testing:**
Since the tests use HTTP and CLI, they could be rewritten in any language:
- Python with `requests` library
- Ruby with `net/http`
- Go with `net/http`
- Bash with `curl`

This demonstrates true implementation independence.

---

## Benefits of This Design

### 1. Testability
- Every component can be tested in isolation
- Integration tests use protocol-based I/O (HTTP, CLI)
- No need for complex mocking of external services

### 2. Flexibility
- Swap Linear for Jira/GitHub/any issue tracker
- Swap Claude for OpenAI/local models
- Swap git for other VCS or no VCS
- Support multiple UIs (CLI, Web, Desktop)

### 3. Maintainability
- Clear separation of concerns
- Business logic isolated in orchestrator
- Adapters contain only I/O code
- Easy to add new implementations

### 4. Scalability
- Can run Cyrus in different modes (cloud, local, CLI)
- Persistence can scale from files to databases
- HTTP interface enables web UI/API access

### 5. Developer Experience
- Interfaces are self-documenting via TypeScript
- Clear boundaries between packages
- Easy to contribute new adapters
- Local development without external dependencies

---

## Success Criteria

The refactoring is successful when:

1. ✅ All existing tests pass with new architecture
2. ✅ CLI interface can fully emulate Linear experience
3. ✅ Integration tests run via HTTP and CLI
4. ✅ Zero direct imports of Linear SDK in orchestrator
5. ✅ Zero direct imports of ClaudeRunner in orchestrator
6. ✅ Can swap adapters without changing orchestrator code
7. ✅ Documentation clearly explains all interfaces
8. ✅ Example implementation in another language (Python test client)

---

## Implementation Checklist

- [ ] Create `packages/cyrus-interfaces` with all interface definitions
- [ ] Create `packages/cyrus-adapters-memory` for testing
- [ ] Create `packages/cyrus-adapters-linear` wrapping Linear SDK
- [ ] Create `packages/cyrus-adapters-claude` wrapping ClaudeRunner
- [ ] Create `packages/cyrus-adapters-local` for file system, git, HTTP
- [ ] Create `packages/cyrus-orchestrator` with core logic
- [ ] Refactor `apps/cli` to use orchestrator
- [ ] Refactor `packages/edge-worker` to use orchestrator
- [ ] Create `packages/cyrus-adapters-cli` for CLI interface
- [ ] Create `packages/cyrus-integration-tests` with protocol tests
- [ ] Update all existing tests to pass
- [ ] Write comprehensive integration tests
- [ ] Document all interfaces
- [ ] Create example Python test client
- [ ] Demonstrate CLI mode working end-to-end
- [ ] Demonstrate HTTP API working end-to-end

---

## Timeline Estimate

- **Phase 1** (Interfaces): 2-3 hours
- **Phase 2** (Adapters): 8-10 hours
- **Phase 3** (Memory Adapters): 2-3 hours
- **Phase 4** (Orchestrator): 6-8 hours
- **Phase 5** (Refactoring): 10-12 hours
- **Phase 6** (CLI Interface): 6-8 hours
- **Phase 7** (Integration Tests): 4-6 hours

**Total**: 38-50 hours of focused work

---

## Next Steps

1. Review and approve this design
2. Begin Phase 1: Create interface package
3. Set up new package structure with pnpm workspace
4. Implement interfaces with full TypeScript types and JSDoc
5. Proceed methodically through each phase
