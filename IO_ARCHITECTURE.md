# Cyrus I/O Architecture Redesign

## Overview

This document outlines the redesign of Cyrus's I/O system to be interface-driven, testable, and implementation-agnostic.

## Current Architecture Analysis

### Pain Points
1. **Tight Coupling**: EdgeWorker directly depends on Linear SDK, LinearWebhookClient, and specific webhook payload shapes
2. **No Abstraction**: ClaudeRunner is a concrete class, not behind an interface
3. **Linear Assumptions**: Core logic assumes Linear concepts (issues, comments, agent sessions)
4. **Testing Difficulty**: No way to test without real Linear/Anthropic connections
5. **Single Interface**: Can't add CLI, web, or other UIs without major refactoring

### Current Flow
```
Linear Webhook → EdgeWorker → AgentSessionManager → ClaudeRunner → Anthropic SDK
      ↓                                                      ↓
Linear SDK (post responses)                          File System
```

## Target Architecture

### Layered Design
```
┌─────────────────────────────────────────────────────────┐
│              Application Layer                           │
│  - EdgeWorkerApp (orchestrator for Linear)              │
│  - CLIApp (interactive CLI experience)                  │
│  - HTTPTestApp (for testing)                            │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│            Core Orchestration (interface-driven)         │
│  - SessionOrchestrator                                   │
│  - WorkItemProcessor                                     │
│  - ActivityManager                                       │
└───────┬────────────┬────────────┬───────────────────────┘
        │            │            │
   ┌────▼───┐   ┌───▼────┐  ┌───▼──────┐
   │IUserUI │   │IAgent  │  │IWorkspace│
   │        │   │Runner  │  │Manager   │
   └────────┘   └────────┘  └──────────┘
        │            │            │
   ┌────▼───────────▼────────────▼────────┐
   │     Implementation Layer              │
   │  - LinearAdapter                      │
   │  - CLIAdapter                         │
   │  - AnthropicClaudeRunner              │
   │  - GitWorktreeManager                 │
   └───────────────────────────────────────┘
```

## Core Interfaces

### 1. IUserInterface

Represents any system that can send work to Cyrus and receive results.

```typescript
interface IUserInterface {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Input: Work items flow INTO Cyrus
  onWorkItem(handler: (item: WorkItem) => void | Promise<void>): void;

  // Output: Activities flow OUT OF Cyrus
  postActivity(activity: Activity): Promise<void>;
  updateWorkItem(id: string, update: WorkItemUpdate): Promise<void>;

  // Query
  getWorkItem(id: string): Promise<WorkItem>;
  getWorkItemHistory(id: string): Promise<Activity[]>;
}

interface WorkItem {
  id: string;
  type: 'task' | 'command' | 'conversation';
  title: string;
  description: string;
  context: Record<string, unknown>;
  metadata: {
    source: string; // 'linear', 'cli', 'http', etc.
    assignee?: string;
    priority?: number;
    [key: string]: unknown;
  };
}

interface Activity {
  id: string;
  workItemId: string;
  timestamp: Date;
  type: 'thought' | 'action' | 'result' | 'error';
  content: ActivityContent;
  metadata?: Record<string, unknown>;
}

type ActivityContent =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'error'; message: string; stack?: string };

interface WorkItemUpdate {
  status?: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress?: number; // 0-100
  message?: string;
}
```

### 2. IAgentRunner

Abstract interface for any AI/agent tool (Claude, GPT, Cursor, etc.).

```typescript
interface IAgentRunner {
  // Configuration
  readonly config: AgentRunnerConfig;

  // Lifecycle
  initialize(): Promise<void>;
  cleanup(): Promise<void>;

  // Execution
  execute(prompt: AgentPrompt): Promise<AgentSession>;

  // Event handling
  onMessage(handler: (message: AgentMessage) => void): void;
  onComplete(handler: (result: AgentResult) => void): void;
  onError(handler: (error: Error) => void): void;
}

interface AgentPrompt {
  content: string | AsyncIterable<AgentMessage>;
  context?: {
    workingDirectory?: string;
    environment?: Record<string, string>;
    tools?: ToolConfig[];
    systemPrompt?: string;
    [key: string]: unknown;
  };
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool_result';
  content: AgentMessageContent;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

type AgentMessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown };

interface AgentSession {
  id: string;
  messages: AsyncIterable<AgentMessage>;
  result: Promise<AgentResult>;
  cancel(): Promise<void>;
  addMessage(content: string): void; // For streaming mode
}

interface AgentResult {
  sessionId: string;
  status: 'success' | 'error' | 'cancelled';
  messages: AgentMessage[];
  error?: Error;
  metadata: {
    duration?: number;
    tokensUsed?: number;
    [key: string]: unknown;
  };
}

interface AgentRunnerConfig {
  workingDirectory: string;
  environment?: Record<string, string>;
  tools?: ToolConfig[];
  systemPrompt?: string;
  modelId?: string;
  [key: string]: unknown;
}
```

### 3. IWorkspaceManager

Manages isolated workspaces (git worktrees, docker containers, etc.).

```typescript
interface IWorkspaceManager {
  createWorkspace(request: WorkspaceRequest): Promise<Workspace>;
  destroyWorkspace(id: string): Promise<void>;
  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspaces(): Promise<Workspace[]>;
}

interface WorkspaceRequest {
  workItemId: string;
  repository: {
    url: string;
    branch?: string;
    commit?: string;
  };
}

interface Workspace {
  id: string;
  path: string;
  status: 'initializing' | 'ready' | 'active' | 'destroyed';
  createdAt: Date;
  metadata: Record<string, unknown>;
}
```

### 4. IPersistence

Generic persistence interface.

```typescript
interface IPersistence<T> {
  save(key: string, data: T): Promise<void>;
  load(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}
```

## Implementation Plan

### Phase 1: Create Interface Package
- Create `packages/interfaces/` with all TypeScript interfaces
- Add JSDoc documentation
- Export all interfaces from single entry point

### Phase 2: Implement Adapters
- **LinearAdapter**: Wraps Linear SDK, translates webhooks to WorkItems
- **CLIAdapter**: Terminal-based interface with rich rendering
- **HTTPTestAdapter**: HTTP endpoints for testing

### Phase 3: Implement Agent Runner
- **AnthropicClaudeRunner**: Wraps existing ClaudeRunner behind IAgentRunner

### Phase 4: Create Core Orchestrator
- **SessionOrchestrator**: Coordinates WorkItems → Agent → Activities
- Uses interfaces only, no concrete dependencies

### Phase 5: Refactor EdgeWorker
- Make EdgeWorker use SessionOrchestrator with LinearAdapter
- Remove direct Linear SDK dependencies from core logic

### Phase 6: Build CLI Interface
- Create CLIAdapter with rich terminal UI
- Support same operations as Linear (tasks, feedback, status)
- Use ink (React for CLIs) or blessed for rendering

### Phase 7: Testing Infrastructure
- Create HTTPTestAdapter
- Write integration tests using HTTP/JSON
- Add language-agnostic test scripts (Python, bash, etc.)

## Testing Strategy

### Contract Tests
Every interface implementation must pass a contract test suite.

```typescript
export function testUserInterfaceContract(
  factory: () => Promise<IUserInterface>
): void {
  describe('IUserInterface Contract', () => {
    it('should emit work items', async () => {
      const ui = await factory();
      const items: WorkItem[] = [];
      ui.onWorkItem(item => items.push(item));

      await triggerWorkItem(ui);

      expect(items).toHaveLength(1);
      expect(items[0].id).toBeDefined();
    });

    it('should post activities', async () => {
      const ui = await factory();
      await ui.initialize();

      const activity: Activity = {
        id: 'test-1',
        workItemId: 'work-1',
        timestamp: new Date(),
        type: 'thought',
        content: { type: 'text', text: 'Test' }
      };

      await expect(ui.postActivity(activity)).resolves.not.toThrow();
    });

    // ... more tests
  });
}
```

### Integration Tests (HTTP)
```bash
# Start Cyrus with HTTP test adapter
cyrus serve --adapter=http --port=8080

# Submit work via HTTP (can be done from any language)
curl -X POST http://localhost:8080/work-items \
  -H "Content-Type: application/json" \
  -d '{"type": "command", "title": "ls -la"}'

# Poll for activities
curl http://localhost:8080/work-items/work-123/activities

# Verify result
```

## Implementation Notes

### Linear Adapter Design
```typescript
class LinearAdapter implements IUserInterface {
  constructor(
    private client: LinearClient,
    private webhookClient: LinearWebhookClient
  ) {}

  async initialize(): Promise<void> {
    this.webhookClient.on('webhook', this.handleWebhook.bind(this));
    await this.webhookClient.connect();
  }

  private handleWebhook(webhook: LinearWebhook): void {
    // Translate Linear webhook to WorkItem
    const workItem = this.translateWebhookToWorkItem(webhook);
    this.workItemHandler?.(workItem);
  }

  async postActivity(activity: Activity): Promise<void> {
    // Translate Activity to Linear AgentActivity
    const linearActivity = this.translateActivityToLinear(activity);

    // Post to Linear
    await this.client.createAgentActivity(linearActivity);
  }
}
```

### CLI Adapter Design
```typescript
class CLIAdapter implements IUserInterface {
  constructor(
    private stdin: NodeJS.ReadStream,
    private stdout: NodeJS.WriteStream,
    private renderer: CLIRenderer
  ) {}

  async initialize(): Promise<void> {
    // Set up readline
    // Display welcome
    this.startCommandLoop();
  }

  async postActivity(activity: Activity): Promise<void> {
    // Render activity to terminal
    this.renderer.renderActivity(activity);
  }

  private async commandLoop(): Promise<void> {
    // Read commands: /task, /status, /help, etc.
    // Parse and emit WorkItems
  }
}
```

## Success Criteria

- [ ] All interfaces defined with complete TypeScript types
- [ ] Linear adapter passes all contract tests
- [ ] CLI adapter passes all contract tests
- [ ] HTTP test adapter implemented
- [ ] Integration tests pass from HTTP client
- [ ] Can switch adapters via configuration
- [ ] No Linear-specific code in core orchestration layer
- [ ] All existing tests still pass
- [ ] New integration tests cover full workflows

## File Structure

```
packages/
├── interfaces/              # NEW: Interface definitions
│   ├── src/
│   │   ├── IUserInterface.ts
│   │   ├── IAgentRunner.ts
│   │   ├── IWorkspaceManager.ts
│   │   ├── IPersistence.ts
│   │   └── index.ts
│   └── test/
│       └── contracts/
│           ├── IUserInterface.contract.test.ts
│           └── IAgentRunner.contract.test.ts
│
├── adapters/                # NEW: Adapter implementations
│   ├── linear/
│   │   ├── src/
│   │   │   ├── LinearAdapter.ts
│   │   │   └── translators.ts
│   │   └── test/
│   │       └── LinearAdapter.test.ts
│   │
│   ├── cli/
│   │   ├── src/
│   │   │   ├── CLIAdapter.ts
│   │   │   ├── CLIRenderer.ts
│   │   │   └── CommandParser.ts
│   │   └── test/
│   │       └── CLIAdapter.test.ts
│   │
│   ├── http/
│   │   ├── src/
│   │   │   └── HTTPTestAdapter.ts
│   │   └── test/
│   │       └── HTTPTestAdapter.test.ts
│   │
│   └── anthropic/
│       ├── src/
│       │   └── AnthropicAgentRunner.ts
│       └── test/
│           └── AnthropicAgentRunner.test.ts
│
├── orchestration/           # NEW: Core orchestration logic
│   ├── src/
│   │   ├── SessionOrchestrator.ts
│   │   ├── WorkItemProcessor.ts
│   │   └── ActivityManager.ts
│   └── test/
│
├── core/                    # UPDATED: Remove Linear dependencies
│   └── ... (existing, refactored)
│
├── edge-worker/             # UPDATED: Use SessionOrchestrator
│   └── ... (existing, refactored)
│
└── integration-tests/       # NEW: Language-agnostic tests
    ├── http-tests/
    │   ├── test.py
    │   ├── test.sh
    │   └── test.ts
    └── fixtures/
```

## Next Steps

1. Create `packages/interfaces/` package
2. Define all interfaces with complete types
3. Write contract test suites
4. Implement LinearAdapter
5. Implement AnthropicAgentRunner
6. Create SessionOrchestrator using interfaces
7. Refactor EdgeWorker to use SessionOrchestrator
8. Implement CLIAdapter
9. Implement HTTPTestAdapter
10. Write integration tests
11. Verify all tests pass
