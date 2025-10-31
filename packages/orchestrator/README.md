# Cyrus Orchestrator

Core session orchestrator that coordinates AgentRunner, IssueTracker, Renderer, and Storage using only abstract interfaces.

## Overview

The `AgentSessionOrchestrator` is the heart of the new Cyrus architecture. It manages agent sessions, coordinates between all I/O systems, and implements core business logic without depending on any specific implementation (Linear, Claude, etc.).

## Key Features

- **Interface-Only Design**: Depends only on abstract interfaces from `cyrus-interfaces`, no concrete implementations
- **Session Lifecycle Management**: Start, pause, resume, and stop agent sessions
- **Bidirectional Streaming**: Handles streaming between IssueTracker → AgentRunner → Renderer
- **Event-Driven Architecture**: Uses EventEmitter for orchestrator-level events
- **Error Handling**: Built-in retry logic for failed operations
- **Concurrent Session Support**: Manages multiple active sessions simultaneously

## Installation

```bash
pnpm add cyrus-orchestrator
```

## Usage

```typescript
import { AgentSessionOrchestrator } from 'cyrus-orchestrator';
import type { AgentRunner, IssueTracker, Renderer, SessionStorage } from 'cyrus-interfaces';

// Provide your implementations
const agentRunner: AgentRunner = ...;
const issueTracker: IssueTracker = ...;
const renderer: Renderer = ...;
const storage: SessionStorage = ...;

// Create orchestrator
const orchestrator = new AgentSessionOrchestrator(
  agentRunner,
  issueTracker,
  renderer,
  storage,
  {
    memberId: 'user-123',
    maxRetries: 3,
    retryDelayMs: 1000,
    maxConcurrentSessions: 10
  }
);

// Listen to events
orchestrator.on('session:started', (sessionId, issueId) => {
  console.log(`Session ${sessionId} started for issue ${issueId}`);
});

orchestrator.on('session:completed', (sessionId, issueId) => {
  console.log(`Session ${sessionId} completed for issue ${issueId}`);
});

orchestrator.on('error', (error, context) => {
  console.error('Orchestrator error:', error, context);
});

// Start orchestrator
await orchestrator.start();

// Start a session manually
const issue = await issueTracker.getIssue('issue-123');
const sessionId = await orchestrator.startSession(issue);

// Handle user input
await orchestrator.handleUserInput(sessionId, 'Please fix the bug');

// Stop orchestrator (gracefully stops all sessions)
await orchestrator.stop();
```

## Architecture

The orchestrator coordinates four main interfaces:

1. **AgentRunner**: Executes AI agent sessions (Claude, Cursor, etc.)
2. **IssueTracker**: Integrates with issue tracking systems (Linear, GitHub, Jira, etc.)
3. **Renderer**: Displays agent activity to users (Linear comments, CLI, HTTP, etc.)
4. **SessionStorage**: Persists session state (file system, database, in-memory, etc.)

## Session Flow

1. **Issue Assignment** → Orchestrator detects issue assigned to monitored user
2. **Session Start** → Creates session, starts agent with issue description
3. **Event Processing** → Routes agent events (text, tool use, errors) to renderer
4. **User Input** → Accepts user messages from renderer, sends to agent
5. **Session Complete** → Updates storage, notifies renderer, cleans up

## API

### Constructor

```typescript
constructor(
  agentRunner: AgentRunner,
  issueTracker: IssueTracker,
  renderer: Renderer,
  storage: SessionStorage,
  config: OrchestratorConfig
)
```

### Methods

- `start()`: Start watching for issue assignments
- `stop()`: Stop orchestrator and gracefully shutdown all sessions
- `startSession(issue, config?)`: Start a new session for an issue
- `stopSession(sessionId)`: Stop a running session
- `pauseSession(sessionId)`: Pause a session (preserves state for resumption)
- `resumeSession(sessionId, config?)`: Resume a paused session
- `handleUserInput(sessionId, message)`: Send user message to agent
- `getSessionStatus(sessionId)`: Get current session state
- `listSessionsForIssue(issueId)`: List all sessions for an issue
- `isSessionActive(sessionId)`: Check if session is active

### Events

- `started`: Orchestrator started
- `stopped`: Orchestrator stopped
- `session:started`: Session started for an issue
- `session:completed`: Session completed successfully
- `session:failed`: Session failed with error
- `session:paused`: Session paused
- `session:stopped`: Session stopped
- `error`: Error occurred with context

## Configuration

```typescript
interface OrchestratorConfig {
  memberId: string;              // User ID to watch for assignments
  maxRetries?: number;           // Max retry attempts (default: 3)
  retryDelayMs?: number;         // Delay between retries (default: 1000ms)
  maxConcurrentSessions?: number; // Max concurrent sessions (default: 10)
}
```

## Testing

The orchestrator is fully testable with mock implementations:

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm typecheck

# Build
pnpm build
```

## Dependencies

- `cyrus-interfaces`: Core interface definitions
- `node:events`: Built-in EventEmitter

## License

MIT
