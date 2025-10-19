# Cyrus I/O System Architecture Design

## Executive Summary

This document describes the comprehensive redesign of Cyrus's I/O system to transform it into a clean, abstract, interface-driven architecture. The goal is to make all I/O systems (Linear, CLI, future interfaces) pluggable implementations conforming to well-defined abstractions.

## Current State Analysis

### Existing I/O Components

1. **Input Systems**
   - Linear webhooks (via `LinearWebhookClient` and `NdjsonClient`)
   - OAuth flow (via `SharedApplicationServer`)
   - File system operations (via `PersistenceManager`)

2. **Processing Systems**
   - `ClaudeRunner` - concrete implementation wrapping Claude SDK
   - `EdgeWorker` - orchestration layer
   - `AgentSessionManager` - session lifecycle management

3. **Output Systems**
   - Linear API (comments, agent sessions, activities)
   - File system (logs, state persistence)
   - Console output

### Current Coupling Issues

1. **ClaudeRunner** is a concrete class, not an abstraction
2. **Linear** is tightly coupled throughout the codebase
3. **No unified interface** for different rendering targets (Linear, CLI, etc.)
4. **Session management** is intertwined with Linear concepts
5. **Testing** is difficult due to tight coupling

## Proposed Architecture

### Core Abstractions

#### 1. Agent Runner Interface

```typescript
/**
 * Abstract interface for any CLI-based agent tool (Claude, GPT Engineer, etc.)
 */
export interface IAgentRunner {
  // Lifecycle
  start(prompt: string | AsyncIterable<IAgentMessage>): Promise<IAgentSession>;
  stop(): void;
  isRunning(): boolean;

  // Streaming support
  addMessage(content: string): void;
  completeStream(): void;
  isStreaming(): boolean;

  // Session info
  getSessionInfo(): IAgentSession | null;
  getMessages(): IAgentMessage[];

  // Events
  on(event: AgentRunnerEvent, handler: (...args: any[]) => void): void;
  off(event: AgentRunnerEvent, handler: (...args: any[]) => void): void;
}

/**
 * Session information (platform-agnostic)
 */
export interface IAgentSession {
  sessionId: string | null;
  startedAt: Date;
  isRunning: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Agent message (platform-agnostic)
 */
export interface IAgentMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'result' | 'tool-use' | 'tool-result';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export type AgentRunnerEvent =
  | 'message'
  | 'text'
  | 'assistant'
  | 'tool-use'
  | 'error'
  | 'complete';
```

#### 2. Input Interface

```typescript
/**
 * Abstract interface for input sources (webhooks, HTTP, CLI, etc.)
 */
export interface IInputSource<TEvent> {
  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;

  // Event handling
  on(event: 'event', handler: (event: TEvent) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'connect' | 'disconnect', handler: () => void): void;

  // Status reporting
  sendStatus?(update: IStatusUpdate): Promise<void>;
}

/**
 * Generic event structure
 */
export interface IInputEvent {
  id: string;
  type: string;
  timestamp: Date;
  data: unknown;
  source: string;
}

/**
 * Status update for processing events
 */
export interface IStatusUpdate {
  eventId: string;
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  metadata?: Record<string, unknown>;
}
```

#### 3. Output Interface (Renderer)

```typescript
/**
 * Abstract interface for rendering agent output to different targets
 */
export interface IOutputRenderer {
  // Identification
  readonly name: string;
  readonly capabilities: RendererCapability[];

  // Session management
  createSession(context: ISessionContext): Promise<IRendererSession>;
  getSession(sessionId: string): IRendererSession | null;
  destroySession(sessionId: string): Promise<void>;

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Session-specific rendering
 */
export interface IRendererSession {
  readonly id: string;
  readonly context: ISessionContext;

  // Output operations
  writeMessage(message: IRendererMessage): Promise<void>;
  writeActivity(activity: IRendererActivity): Promise<void>;
  updateStatus(status: IRendererStatus): Promise<void>;

  // Input operations (for interactive renderers)
  readMessage?(): Promise<IRendererMessage | null>;
  onUserInput?(handler: (input: string) => void): void;

  // Metadata
  getMetadata(): Record<string, unknown>;
  updateMetadata(metadata: Record<string, unknown>): Promise<void>;
}

/**
 * Context for creating a session
 */
export interface ISessionContext {
  taskId: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  parentSessionId?: string;
}

/**
 * Message to be rendered
 */
export interface IRendererMessage {
  type: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Activity tracking (like Linear's agent activity)
 */
export interface IRendererActivity {
  type: 'thinking' | 'tool-use' | 'result' | 'error' | 'status';
  description: string;
  details?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Status update
 */
export interface IRendererStatus {
  state: 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'failed';
  message?: string;
  progress?: number; // 0-100
}

/**
 * Renderer capabilities
 */
export type RendererCapability =
  | 'text-output'
  | 'rich-formatting'
  | 'interactive-input'
  | 'activity-tracking'
  | 'file-attachments'
  | 'threading'
  | 'real-time-updates';
```

#### 4. Orchestrator Interface

```typescript
/**
 * Core orchestrator that connects inputs, processing, and outputs
 */
export interface IOrchestrator {
  // Configuration
  addInputSource(name: string, source: IInputSource<any>): void;
  addOutputRenderer(name: string, renderer: IOutputRenderer): void;
  setAgentRunnerFactory(factory: IAgentRunnerFactory): void;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;

  // Event routing
  on(event: OrchestratorEvent, handler: (...args: any[]) => void): void;
}

/**
 * Factory for creating agent runners
 */
export interface IAgentRunnerFactory {
  create(config: IAgentRunnerConfig): Promise<IAgentRunner>;
  supports(type: string): boolean;
}

/**
 * Agent runner configuration
 */
export interface IAgentRunnerConfig {
  type: string; // 'claude', 'openai', etc.
  model?: string;
  workingDirectory?: string;
  systemPrompt?: string | ISystemPromptConfig;
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export type OrchestratorEvent =
  | 'session:created'
  | 'session:started'
  | 'session:completed'
  | 'session:failed'
  | 'error';
```

### Implementation Strategy

#### Phase 1: Create Core Abstractions (New Package: `@cyrus/abstractions`)

```
packages/abstractions/
├── src/
│   ├── agent/
│   │   ├── IAgentRunner.ts
│   │   ├── IAgentMessage.ts
│   │   └── IAgentSession.ts
│   ├── input/
│   │   ├── IInputSource.ts
│   │   └── IInputEvent.ts
│   ├── output/
│   │   ├── IOutputRenderer.ts
│   │   ├── IRendererSession.ts
│   │   └── types.ts
│   ├── orchestration/
│   │   ├── IOrchestrator.ts
│   │   └── IAgentRunnerFactory.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### Phase 2: Adapt Existing Components

1. **ClaudeAgentRunner** (implements `IAgentRunner`)
   - Wrapper around current `ClaudeRunner`
   - Maps SDK messages to `IAgentMessage`
   - Implements the interface

2. **LinearInputSource** (implements `IInputSource`)
   - Uses existing `LinearWebhookClient` internally
   - Maps webhook events to `IInputEvent`

3. **LinearOutputRenderer** (implements `IOutputRenderer`)
   - Uses Linear SDK to create comments, activities
   - Maps generic activities to Linear agent sessions

#### Phase 3: Create CLI Renderer (New Implementation)

```
packages/cli-renderer/
├── src/
│   ├── CliOutputRenderer.ts       # Main renderer
│   ├── CliRendererSession.ts      # Session management
│   ├── formatters/
│   │   ├── MessageFormatter.ts    # Format messages
│   │   ├── ActivityFormatter.ts   # Format activities
│   │   └── StatusFormatter.ts     # Format status
│   ├── ui/
│   │   ├── TerminalUI.ts          # Terminal UI components
│   │   └── InteractivePrompt.ts   # User input handling
│   └── index.ts
├── package.json
└── tsconfig.json
```

**CLI Renderer Features:**
- Rich terminal output using `chalk`, `ora`, `inquirer`
- Activity timeline similar to Linear's interface
- Interactive mode for user feedback
- Session persistence to file system
- Real-time updates with spinners and progress bars

#### Phase 4: Create Language-Agnostic Test Framework

```
packages/integration-tests/
├── src/
│   ├── harness/
│   │   ├── TestOrchestrator.ts    # Test orchestrator
│   │   ├── MockInputSource.ts     # Mock input
│   │   ├── TestOutputRenderer.ts  # Test output
│   │   └── MockAgentRunner.ts     # Mock agent
│   ├── scenarios/
│   │   ├── basic-workflow.test.ts
│   │   ├── error-handling.test.ts
│   │   └── streaming.test.ts
│   ├── fixtures/
│   │   ├── events.json
│   │   └── expected-outputs.json
│   └── index.ts
├── http-tests/                    # HTTP-based tests
│   ├── server.ts                  # Test HTTP server
│   └── client.ts                  # Test HTTP client
├── stdio-tests/                   # STDIN/STDOUT tests
│   ├── runner.ts
│   └── validator.ts
├── package.json
└── tsconfig.json
```

**Test Framework Principles:**
1. Tests communicate via standard protocols (HTTP, STDIO, JSON)
2. Test scenarios defined in JSON/YAML
3. Can be implemented in any language
4. Validates behavior, not implementation

Example test scenario (JSON):
```json
{
  "name": "basic-agent-workflow",
  "input": {
    "type": "task-created",
    "data": {
      "id": "test-001",
      "title": "Fix bug in login",
      "description": "Users cannot log in"
    }
  },
  "expectedActivities": [
    { "type": "thinking", "pattern": ".*analyzing.*" },
    { "type": "tool-use", "tool": "Read" },
    { "type": "result", "status": "success" }
  ],
  "expectedOutput": {
    "type": "assistant",
    "pattern": ".*fixed.*|.*resolved.*"
  }
}
```

### Package Structure

After implementation:

```
cyrus/
├── packages/
│   ├── abstractions/           # NEW: Core interfaces
│   ├── claude-agent-runner/    # NEW: IAgentRunner impl for Claude
│   ├── claude-runner/          # EXISTING: Kept for SDK wrapping
│   ├── linear-input/           # NEW: IInputSource impl
│   ├── linear-renderer/        # NEW: IOutputRenderer impl
│   ├── cli-renderer/           # NEW: CLI-based renderer
│   ├── orchestrator/           # NEW: Core orchestration
│   ├── integration-tests/      # NEW: Language-agnostic tests
│   ├── core/                   # EXISTING: Shared types (to be reduced)
│   ├── ndjson-client/          # EXISTING: Transport layer
│   └── edge-worker/            # MODIFIED: Uses orchestrator
└── apps/
    └── cli/                    # MODIFIED: Uses orchestrator + renderers
```

### Migration Path

1. **Phase 1** (Week 1): Create abstractions package
   - Define all interfaces
   - Write extensive JSDoc
   - Create example implementations

2. **Phase 2** (Week 2): Implement adapters
   - ClaudeAgentRunner wrapping ClaudeRunner
   - LinearInputSource wrapping LinearWebhookClient
   - LinearOutputRenderer wrapping Linear SDK

3. **Phase 3** (Week 3): Implement CLI renderer
   - Terminal UI components
   - Message/activity formatting
   - Interactive input handling

4. **Phase 4** (Week 4): Create test framework
   - Test harness
   - HTTP/STDIO test runners
   - Test scenarios

5. **Phase 5** (Week 5): Refactor EdgeWorker
   - Use orchestrator pattern
   - Plug in adapters
   - Maintain backward compatibility

6. **Phase 6** (Week 6): Testing and validation
   - Run full test suite
   - Integration testing
   - Performance testing

## Benefits

### 1. Flexibility
- Easy to add new agent runners (GPT Engineer, Devin, etc.)
- Easy to add new renderers (Slack, Discord, Web UI)
- Easy to add new input sources (GitHub, Jira, email)

### 2. Testability
- Mock any component independently
- Test with language-agnostic protocols
- Validate behavior, not implementation

### 3. Maintainability
- Clear separation of concerns
- Single responsibility per component
- Easy to understand and modify

### 4. Reusability
- Components can be used independently
- Interfaces can be implemented in any language
- Clear contracts for integration

## Success Criteria

1. **All existing tests pass** with new architecture
2. **CLI renderer** provides equivalent functionality to Linear
3. **Integration tests** can run via HTTP/STDIO
4. **Performance** is equivalent or better than current system
5. **Documentation** clearly explains all interfaces
6. **Examples** demonstrate each interface usage

## Risk Mitigation

1. **Backward Compatibility**: Keep existing code working during migration
2. **Incremental Migration**: Move one component at a time
3. **Feature Flags**: Toggle between old and new implementations
4. **Comprehensive Testing**: Test each phase before moving to next
5. **Rollback Plan**: Keep old code until new code is proven

## Next Steps

1. Review and approve this design document
2. Create `packages/abstractions` with interface definitions
3. Begin Phase 1 implementation
4. Iterate based on feedback
