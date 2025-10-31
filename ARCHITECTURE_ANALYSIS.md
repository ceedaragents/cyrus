# Cyrus Monorepo - Project Structure & Component Analysis

## Executive Summary

Cyrus is a pnpm monorepo containing a **Linear-integrated AI agent system** built around an extensible architecture. The project uses:

- **Clean Architecture**: Abstract interfaces decoupled from implementations
- **Event-Driven Design**: AsyncIterable-based event streaming throughout
- **Modular Packages**: Separate concerns into independent, composable packages
- **TypeScript/React**: For type-safe development and interactive UIs
- **Ink for Terminal UI**: React-based terminal rendering for CLI applications

---

## 1. Monorepo Structure

```
cyrus/
├── apps/
│   └── cli/                    # Main CLI application (published as 'cyrus-ai')
│
├── packages/
│   ├── interfaces/             # Abstract interface definitions
│   ├── orchestrator/           # Core session orchestrator
│   ├── agent-runners/          # Agent adapters (ClaudeAgentRunner)
│   ├── renderers/              # Output renderers (CLI, Linear)
│   ├── storage/                # Session persistence (FileSessionStorage)
│   ├── issue-trackers/         # Issue tracker adapters (LinearIssueTracker)
│   ├── claude-runner/          # Claude CLI execution wrapper
│   ├── edge-worker/            # Edge worker client
│   ├── simple-agent-runner/    # Simple agent runner
│   ├── core/                   # Shared types & utilities
│   ├── linear-event-transport/ # Linear event handling
│   ├── cloudflare-tunnel-client/
│   ├── config-updater/
│   └── [others]/
│
└── pnpm-workspace.yaml         # Monorepo configuration
```

### Key Statistics
- **16+ packages** in `/packages`
- **1 main app** in `/apps/cli`
- **pnpm** as package manager (v10.11.0)
- **TypeScript** throughout
- **Vitest** for testing

---

## 2. Core Components

### 2.1 Interfaces Package (`cyrus-interfaces`)
**Location**: `/packages/interfaces/src`

Defines the abstract contract that all implementations follow:

#### Key Files:
- `renderer.ts` - Renderer interface
- `agent-runner.ts` - AgentRunner interface
- `storage.ts` - SessionStorage interface
- `issue-tracker.ts` - IssueTracker interface

#### Core Interfaces:

```typescript
// Renderer interface - outputs agent activity to users
interface Renderer {
  renderSessionStart(session: RenderableSession): Promise<void>;
  renderActivity(sessionId: string, activity: AgentActivity): Promise<void>;
  renderText(sessionId: string, text: string): Promise<void>;
  renderToolUse(sessionId: string, tool: string, input: unknown): Promise<void>;
  renderComplete(sessionId: string, summary: SessionSummary): Promise<void>;
  renderError(sessionId: string, error: Error): Promise<void>;
  getUserInput(sessionId: string): AsyncIterable<UserInput>;
}

// AgentRunner interface - executes AI agents
interface AgentRunner {
  start(config: AgentSessionConfig): Promise<AgentSession>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(sessionId: string, config: AgentSessionConfig): Promise<AgentSession>;
  isRunning(sessionId: string): boolean;
  getEventStream(sessionId: string): AsyncIterable<AgentEvent>;
}

// SessionStorage interface - persists session state
interface SessionStorage {
  saveSession(session: SessionState): Promise<void>;
  loadSession(sessionId: string): Promise<SessionState | null>;
  listSessions(issueId: string): Promise<SessionState[]>;
  addMessage(sessionId: string, message: Message): Promise<void>;
  updateStatus(sessionId: string, status: SessionStatus): Promise<void>;
  // ... more methods
}

// IssueTracker interface - integrates with issue systems
interface IssueTracker {
  getIssue(issueId: string): Promise<Issue>;
  listAssignedIssues(memberId: string, filters?: IssueFilters): Promise<Issue[]>;
  watchIssues(memberId: string): AsyncIterable<IssueEvent>;
  addComment(issueId: string, comment: Comment): Promise<string>;
  updateIssueState(issueId: string, state: IssueState): Promise<void>;
  // ... more methods
}
```

---

### 2.2 Orchestrator Package (`cyrus-orchestrator`)
**Location**: `/packages/orchestrator/src`

The **heart of the system** - coordinates all components.

#### Key File: `AgentSessionOrchestrator.ts`

**Responsibilities**:
1. Watches for issue assignments via IssueTracker
2. Creates sessions for new issues
3. Routes agent events to Renderer
4. Collects user input from Renderer
5. Persists session state via SessionStorage
6. Manages session lifecycle (start/pause/resume/stop)

**Constructor**:
```typescript
constructor(
  agentRunner: AgentRunner,      // Executes agents
  issueTracker: IssueTracker,    // Watches for issues
  renderer: Renderer,             // Renders output
  storage: SessionStorage,        // Persists state
  config: OrchestratorConfig,     // Configuration
)
```

**Key Methods**:
- `start()` - Begin orchestration
- `stop()` - Graceful shutdown
- `startSession(issue)` - Create new session for issue
- `stopSession(sessionId)` - Stop running session
- `pauseSession/resumeSession()` - Pause/resume workflows
- `handleUserInput(sessionId, message)` - Process user input

**Event Flow**:
```
IssueTracker.watchIssues()
    ↓
AgentSessionOrchestrator (event router)
    ├→ AgentRunner.start() (start agent)
    │     ↓
    │ AgentSession.events (async iterable)
    │     ↓
    ├→ Renderer.render*() (display results)
    │
    ├→ Renderer.getUserInput() (collect input)
    │     ↓
    └→ AgentRunner.sendMessage() (feed to agent)

SessionStorage.save*() (persist everything)
```

---

### 2.3 Agent Runners (`cyrus-agent-runners`)
**Location**: `/packages/agent-runners/src/claude/`

#### Key File: `ClaudeAgentRunner.ts`

**Purpose**: Adapter that bridges ClaudeRunner to AgentRunner interface

**Key Responsibilities**:
1. Wraps `ClaudeRunner` (existing CLI runner)
2. Converts ClaudeRunner events to AgentEvent types
3. Manages async iterable event streams
4. Handles streaming prompts via AsyncIterable<UserMessage>

**Implementation Pattern**:
```typescript
export class ClaudeAgentRunner implements AgentRunner {
  constructor(defaultConfig: Partial<ClaudeRunnerConfig> = {}) {}
  
  async start(config: AgentSessionConfig): Promise<AgentSession> {
    const runner = new ClaudeRunner(claudeConfig);
    this.setupEventListeners(runner, sessionState);
    
    if (typeof config.prompt === "string") {
      sessionInfo = await runner.start(config.prompt);
    } else {
      sessionInfo = await runner.startStreaming();
      this.streamUserMessages(config.prompt, runner);
    }
    
    return {
      id: sessionInfo.sessionId,
      startedAt: sessionInfo.startedAt,
      events: this.createEventStream(sessionId),
    };
  }
  
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const sessionState = this.sessions.get(sessionId);
    sessionState.runner.addStreamMessage(message);
  }
}
```

**Event Conversion**:
- ClaudeRunner `text` event → AgentEvent with type "text"
- ClaudeRunner `tool-use` event → AgentEvent with type "tool-use"
- ClaudeRunner `error` event → AgentEvent with type "error"
- ClaudeRunner `complete` event → AgentEvent with type "complete"

---

### 2.4 Renderers (`@cyrus/renderers`)
**Location**: `/packages/renderers/src`

#### 2.4.1 CLIRenderer
**File**: `src/cli/CLIRenderer.ts`

**Purpose**: Interactive terminal UI for agent sessions

**Key Features**:
- Real-time activity panel (like Linear's UI)
- Scrollable activity history
- Interactive message input
- Stop command (Ctrl+S)
- Multi-session support
- Status indicators with configurable icons

**Configuration**:
```typescript
interface CLIRendererConfig {
  verboseFormatting?: boolean;    // Enable emoji icons (default: true)
  maxActivities?: number;          // Buffer size (default: 100)
  statusIcons?: Partial<StatusIcons>; // Custom icons
}

interface StatusIcons {
  thought: string;      // 💭
  action: string;       // 🔧
  response: string;     // 💬
  error: string;        // ❌
  // ... more
}
```

**Technical Stack**:
- **Ink** (v5.0.1) - React-based terminal renderer
- **React** (v18.3.1) - Component framework
- **chalk** (v5.3.0) - Terminal colors
- **ink-text-input** - Text input component
- **ink-spinner** - Spinner animation

**React Components**:
- `ActivityPanel` (main container)
  - `SessionPanel` (per-session view)
    - `ActivityItemComponent` (individual activity)

**State Management**:
```typescript
interface SessionState {
  session: RenderableSession;
  activities: ActivityItem[];
  status: "running" | "complete" | "error";
  error?: Error;
}
```

**Input Queue System**:
- Uses EventEmitter to signal new input
- Queues user messages and signals
- Yields via `getUserInput()` async iterable

#### 2.4.2 LinearRenderer
**File**: `src/linear/LinearRenderer.ts`

**Purpose**: Posts agent activity as Linear issue comments

**Key Methods**:
- Converts agent events to Linear AgentActivity format
- Posts comments to Linear issues
- Handles Linear GraphQL API integration

---

### 2.5 Storage (`cyrus-storage`)
**Location**: `/packages/storage/src`

#### Key File: `FileSessionStorage.ts`

**Purpose**: File-based persistence of session state

**Directory Structure**:
```
~/.cyrus/sessions/
├── <issueId1>/
│   ├── session-<sessionId1>.json
│   ├── session-<sessionId2>.json
│   └── metadata.json
├── <issueId2>/
│   └── ...
```

**Key Methods**:
```typescript
export class FileSessionStorage implements SessionStorage {
  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(homedir(), ".cyrus", "sessions");
  }
  
  async saveSession(session: SessionState): Promise<void>;
  async loadSession(sessionId: string): Promise<SessionState | null>;
  async listSessions(issueId: string): Promise<SessionState[]>;
  async addMessage(sessionId: string, message: Message): Promise<void>;
  async updateStatus(sessionId: string, status: SessionStatus): Promise<void>;
  // ... more
}
```

**Atomic Operations**:
- Uses temp file + rename pattern for atomicity
- Prevents corruption on crashes
- Ensures data consistency

---

### 2.6 Issue Trackers (`packages/issue-trackers`)
**Location**: `/packages/issue-trackers/src/linear/`

#### Key File: `LinearIssueTracker.ts`

**Purpose**: Integrates with Linear API

**Key Features**:
- Watches for issue assignments via Linear webhooks/events
- Maps Linear types to standard interfaces
- Adds comments to issues
- Updates issue state
- Handles Linear-specific features

**Event Stream**:
- Uses async generator to yield `IssueEvent`
- Event types:
  - `assigned` - Issue assigned to agent
  - `comment-added` - User added comment
  - `state-changed` - Issue state updated
  - `unassigned` - Issue unassigned
  - `signal` - Agent control signal

---

## 3. How They Wire Together

### 3.1 Wiring in Application (Orchestrator Pattern)

```typescript
// 1. Create implementations
const agentRunner = new ClaudeAgentRunner({
  cyrusHome: process.env.CYRUS_HOME,
  // ... config
});

const renderer = new CLIRenderer({
  verboseFormatting: true,
  maxActivities: 100,
});

const storage = new FileSessionStorage(
  path.join(process.env.CYRUS_HOME, "sessions")
);

const issueTracker = new LinearIssueTracker(linearClient, {
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
  // ... config
});

// 2. Create orchestrator (the coordinator)
const orchestrator = new AgentSessionOrchestrator(
  agentRunner,
  issueTracker,
  renderer,
  storage,
  {
    memberId: agentId,
    maxConcurrentSessions: 10,
    maxRetries: 3,
    retryDelayMs: 1000,
  }
);

// 3. Start orchestration
await orchestrator.start();

// 4. Listen for events
orchestrator.on("session:started", (sessionId, issueId) => {
  console.log(`Session started for ${issueId}`);
});

orchestrator.on("session:completed", (sessionId, issueId) => {
  console.log(`Session completed for ${issueId}`);
});

orchestrator.on("error", (error, context) => {
  console.error(`Error in ${context}:`, error);
});
```

### 3.2 Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   IssueTracker                                  │
│                (watches for issues)                             │
└────────────────────────┬────────────────────────────────────────┘
                         │ IssueEvent async iterable
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            AgentSessionOrchestrator                             │
│                  (coordinator)                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐   │
│  │  AgentRunner     │  │  Renderer        │  │  Storage    │   │
│  ├──────────────────┤  ├──────────────────┤  ├─────────────┤   │
│  │ .start()         │  │ .renderText()    │  │ .save()     │   │
│  │ .sendMessage()   │  │ .getUserInput()  │  │ .load()     │   │
│  │ .stop()          │  │ .renderError()   │  │ .addMsg()   │   │
│  │ .resume()        │  │ .renderComplete()│  │ .updateSt() │   │
│  └──────────────────┘  └──────────────────┘  └─────────────┘   │
│       events ↑           input ↑                                 │
│       stream              stream                                 │
│         │ │               ↑ │                                   │
└─────────┼─┼───────────────┼─┼─────────────────────────────────┘
          │ │               │ │
   ┌──────▼─▼───────┐   ┌──▼─▼──────────────┐
   │ ClaudeRunner    │   │ ActivityPanel     │
   │ (executes)      │   │ (React + Ink)     │
   └─────────────────┘   └───────────────────┘
```

### 3.3 Data Flow Examples

#### Example 1: Issue Assignment Workflow
```
1. LinearIssueTracker detects: "Issue assigned to Cyrus"
2. Emits: IssueAssignedEvent
3. Orchestrator receives event
4. Calls: AgentRunner.start(config)
5. AgentRunner creates ClaudeRunner
6. Orchestrator calls: Renderer.renderSessionStart()
7. CLIRenderer displays: "Session started"
8. Orchestrator starts consuming: agentSession.events (async iterable)
9. Agent produces: TextEvent { type: "text", content: "..." }
10. Orchestrator routes to: Renderer.renderText()
11. CLIRenderer displays text in ActivityPanel
12. Orchestrator stores: Storage.addMessage()
13. File is written to disk
```

#### Example 2: User Input Workflow
```
1. CLIRenderer receives user typing in ActivityPanel
2. User presses Enter
3. CLIRenderer emits: onMessage(sessionId, text)
4. CLIRenderer enqueues UserInput to inputQueues[sessionId]
5. Orchestrator awaits: Renderer.getUserInput(sessionId)
6. Yields UserInput from queue
7. Orchestrator calls: AgentRunner.sendMessage(sessionId, text)
8. ClaudeAgentRunner calls: runner.addStreamMessage(text)
9. ClaudeRunner feeds to Claude API
10. New events are produced
11. Cycle continues...
```

#### Example 3: Session Completion
```
1. AgentRunner emits: CompleteEvent with SessionSummary
2. Orchestrator calls: Renderer.renderComplete()
3. CLIRenderer displays completion summary
4. Orchestrator updates: Storage.updateStatus(sessionId, "completed")
5. File is written with final state
6. Orchestrator emits: "session:completed" event
7. ActiveSession is removed from memory
8. Session history is preserved on disk
```

---

## 4. Configuration & Setup Requirements

### 4.1 Environment Variables
```bash
# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Linear Integration
LINEAR_API_KEY=lin_...
LINEAR_WEBHOOK_SECRET=...

# Storage
CYRUS_HOME=~/.cyrusd        # Base directory for all data

# Edge Worker (optional)
CYRUS_SERVER_PORT=3000      # Edge worker port
```

### 4.2 Package Dependencies

#### Key External Dependencies
- `@linear/sdk` (v60.0.0) - Linear API client
- `cyrus-claude-runner` - Claude CLI wrapper
- `ink` (v5.0.1) - Terminal UI
- `react` (v18.3.1) - UI components
- `chalk` (v5.3.0) - Terminal colors
- `zod` (v3.24.4) - Schema validation

#### Internal Dependencies (workspace:*)
```
Orchestrator depends on:
  ├── interfaces
  └── (agent-runners, renderers, storage, issue-trackers are injected)

CLIRenderer depends on:
  ├── interfaces
  ├── ink
  ├── react
  └── chalk

ClaudeAgentRunner depends on:
  ├── interfaces
  ├── cyrus-claude-runner
  └── (no other workspace deps)

FileSessionStorage depends on:
  └── interfaces (only)

LinearIssueTracker depends on:
  ├── interfaces
  └── @linear/sdk
```

### 4.3 Build & Development

#### Build All Packages
```bash
cd /Users/agentops/code/cyrus-workspaces/CYPACK-273
pnpm install
pnpm build
```

#### TypeScript Configuration
- **Base**: `tsconfig.base.json` at root
- **Per-package**: `tsconfig.json` extending base
- **Target**: ES2022
- **Module**: ESNext
- **Strict**: true

#### Typing Paths (for IDE support)
```json
{
  "paths": {
    "cyrus-core": ["packages/core/src"],
    "cyrus-claude-runner": ["packages/claude-runner/src"],
    // ... etc
  }
}
```

---

## 5. Key APIs & Patterns

### 5.1 AsyncIterable Pattern

**Used for streaming data**:
- `agentSession.events` - Stream of agent events
- `renderer.getUserInput()` - Stream of user input
- `issueTracker.watchIssues()` - Stream of issue changes

**Pattern**:
```typescript
// Producer
async function* watchEvents() {
  while (true) {
    const event = await getNextEvent();
    yield event;
  }
}

// Consumer
for await (const event of watchEvents()) {
  processEvent(event);
}
```

### 5.2 Discriminated Union Types

**Used for type-safe event handling**:
```typescript
type AgentEvent = 
  | TextEvent 
  | ToolUseEvent 
  | ToolResultEvent 
  | ErrorEvent 
  | CompleteEvent;

// Type-safe switch
switch (event.type) {
  case "text":
    // event.content available here
    break;
  case "tool-use":
    // event.tool and event.input available
    break;
  // ... etc
}
```

### 5.3 EventEmitter for Local Events

```typescript
// In CLIRenderer
private eventEmitter = new EventEmitter();

// Emit updates
this.eventEmitter.emit("update", updatedSessions);

// Listen for updates
eventEmitter.on("update", (sessions) => {
  setCurrentSessions(sessions);
});
```

### 5.4 Retry Logic

**Built into Orchestrator**:
```typescript
private async withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt < this.config.maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.retryDelayMs)
        );
      }
    }
  }
}
```

---

## 6. File Locations Summary

### Interfaces
- `/packages/interfaces/src/renderer.ts`
- `/packages/interfaces/src/agent-runner.ts`
- `/packages/interfaces/src/storage.ts`
- `/packages/interfaces/src/issue-tracker.ts`

### Implementations
- **Orchestrator**: `/packages/orchestrator/src/AgentSessionOrchestrator.ts`
- **CLIRenderer**: `/packages/renderers/src/cli/CLIRenderer.ts`
- **ClaudeAgentRunner**: `/packages/agent-runners/src/claude/ClaudeAgentRunner.ts`
- **FileSessionStorage**: `/packages/storage/src/FileSessionStorage.ts`
- **LinearIssueTracker**: `/packages/issue-trackers/src/linear/LinearIssueTracker.ts`

### CLI App
- **Entry**: `/apps/cli/src/app.ts`
- **Config**: `/apps/cli/src/config/`
- **Commands**: `/apps/cli/src/commands/`
- **Services**: `/apps/cli/src/services/`

### Package Exports
- **Orchestrator**: exports AgentSessionOrchestrator
- **Renderers**: exports CLIRenderer, LinearRenderer
- **Agent Runners**: exports ClaudeAgentRunner
- **Storage**: exports FileSessionStorage
- **Interfaces**: exports all interface types

---

## 7. Testing Patterns

### Vitest Setup
```bash
# Run all tests
pnpm test

# Run tests in packages only
pnpm test:packages:run

# Watch mode
pnpm test --watch

# Coverage
pnpm test:coverage
```

### Test Organization
- Tests co-located with source (*.test.ts)
- Mock utilities via vitest-mock-extended
- Config files: vitest.config.ts per package

---

## 8. Deployment & Publishing

### Build Order
1. Install dependencies: `pnpm install`
2. Build all: `pnpm build`
3. TypeCheck: `pnpm typecheck`

### Publishing Order (from CLAUDE.md)
1. `ndjson-client`
2. `claude-runner`
3. `core`
4. `simple-agent-runner`
5. `edge-worker`
6. Finally: `cli` (apps/cli)

---

## 9. Next Steps for Interactive CLI Application

### To build an interactive CLI app using these components:

1. **Create instance** of each component:
   - `ClaudeAgentRunner` for agent execution
   - `CLIRenderer` for interactive terminal UI
   - `FileSessionStorage` for persistence
   - `LinearIssueTracker` for issue monitoring

2. **Wire via Orchestrator**:
   ```typescript
   const orchestrator = new AgentSessionOrchestrator(
     agentRunner,
     issueTracker,
     renderer,
     storage,
     { memberId: "agent-id" }
   );
   ```

3. **Start the orchestrator**:
   ```typescript
   await orchestrator.start();
   ```

4. **Listen for events**:
   ```typescript
   orchestrator.on("session:started", ...);
   orchestrator.on("session:completed", ...);
   orchestrator.on("error", ...);
   ```

5. **The CLIRenderer automatically**:
   - Displays the Ink-based ActivityPanel
   - Collects user input
   - Streams to orchestrator via `getUserInput()`

This is the **production-ready architecture** for building Cyrus-based applications!

