# cyrus-interfaces

Core I/O interface definitions for the Cyrus architecture.

## Overview

This package provides pure TypeScript interface definitions that decouple the Cyrus core orchestration logic from specific implementations of:

- **Agent Runners** (Claude, Cursor, etc.)
- **Issue Trackers** (Linear, GitHub Issues, Jira, etc.)
- **Renderers** (Linear comments, CLI terminal, HTTP, etc.)
- **Session Storage** (File system, database, in-memory, etc.)

## Design Principles

1. **Zero Runtime Dependencies** - Pure TypeScript types only
2. **Implementation Agnostic** - Works with any concrete implementation
3. **Testability First** - Enables easy mocking and testing
4. **Clean Separation** - Core logic never directly imports Linear or Claude SDKs
5. **Extensibility** - Generic types and discriminated unions for flexibility

## Interfaces

### AgentRunner

Abstract interface for running AI agents (Claude, Cursor, etc.)

```typescript
interface AgentRunner {
  start(config: AgentSessionConfig): Promise<AgentSession>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(sessionId: string, config: AgentSessionConfig): Promise<AgentSession>;
  isRunning(sessionId: string): boolean;
  getEventStream(sessionId: string): AsyncIterable<AgentEvent>;
}
```

### IssueTracker

Abstract interface for issue tracking systems (Linear, GitHub, Jira, etc.)

```typescript
interface IssueTracker {
  getIssue(issueId: string): Promise<Issue>;
  listAssignedIssues(memberId: string, filters?: IssueFilters): Promise<Issue[]>;
  updateIssueState(issueId: string, state: IssueState): Promise<void>;
  addComment(issueId: string, comment: Comment): Promise<string>;
  getComments(issueId: string): Promise<Comment[]>;
  watchIssues(memberId: string): AsyncIterable<IssueEvent>;
  getAttachments(issueId: string): Promise<Attachment[]>;
  sendSignal(issueId: string, signal: AgentSignal): Promise<void>;
}
```

### Renderer

Abstract interface for rendering agent activity to users

```typescript
interface Renderer {
  renderSessionStart(session: RenderableSession): Promise<void>;
  renderActivity(sessionId: string, activity: AgentActivity): Promise<void>;
  renderText(sessionId: string, text: string): Promise<void>;
  renderToolUse(sessionId: string, tool: string, input: unknown): Promise<void>;
  renderComplete(sessionId: string, summary: SessionSummary): Promise<void>;
  renderError(sessionId: string, error: Error): Promise<void>;
  getUserInput(sessionId: string): AsyncIterable<UserInput>;
}
```

### SessionStorage

Abstract interface for persisting session state

```typescript
interface SessionStorage {
  saveSession(session: SessionState): Promise<void>;
  loadSession(sessionId: string): Promise<SessionState | null>;
  listSessions(issueId: string): Promise<SessionState[]>;
  querySessions(filters: SessionFilters): Promise<SessionState[]>;
  deleteSession(sessionId: string): Promise<void>;
  sessionExists(sessionId: string): Promise<boolean>;
  addMessage(sessionId: string, message: Message): Promise<void>;
  updateStatus(sessionId: string, status: SessionStatus): Promise<void>;
}
```

## Usage

```typescript
import type { AgentRunner, IssueTracker, Renderer, SessionStorage } from 'cyrus-interfaces';

// Implementations will use these interfaces
class ClaudeRunner implements AgentRunner {
  // Implementation details...
}

class LinearTracker implements IssueTracker {
  // Implementation details...
}

class TerminalRenderer implements Renderer {
  // Implementation details...
}

class FileStorage implements SessionStorage {
  // Implementation details...
}
```

## Architecture

This package is the foundation of the Cyrus I/O architecture redesign. See `IO_ARCHITECTURE_DESIGN.md` in the repository root for the complete design document.

## Development

```bash
# Build the package
pnpm build

# Type check
pnpm typecheck

# Watch mode
pnpm dev
```

## License

See repository root for license information.
