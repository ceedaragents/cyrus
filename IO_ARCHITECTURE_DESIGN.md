# Cyrus I/O Architecture Design

## Executive Summary

This document outlines the comprehensive redesign of Cyrus's I/O system to create a sophisticated, testable, and extensible architecture based on clean abstractions. The goal is to decouple the core agent orchestration logic from specific implementations of issue trackers (Linear), agent runners (Claude), and output renderers (Linear comments, CLI).

## Research Findings

### Cursor CLI Headless Mode
- **Key Insight**: Uses `--print` flag for non-interactive automation
- **Output Formats**: text, json, stream-json for different use cases
- **Architecture**: Message-streaming pipeline with incremental deltas
- **Control**: Force flags for file modifications, output format selection
- **Authentication**: Environment variable based (CURSOR_API_KEY)

### Factory.ai CLI
- **Key Insight**: Dual mode operation (interactive REPL vs non-interactive exec)
- **Input Flexibility**: Direct args, file-based (-f), piped content, session continuation
- **Output Abstraction**: Text/JSON/Stream-JSON formats for programmatic parsing
- **Autonomy Levels**: Tiered permission abstraction for safe escalation
- **Testability**: Exit codes, structured JSON, file-based prompts, session IDs

### Linear Activity Panel Analysis
From the screenshot, the Linear interface provides:
- **Real-time status updates**: Shows agent progress and activity
- **Interactive messaging**: "Message Cyrus" input with attachment support
- **Stop/Control**: Stop icon and stop message capability
- **Comment threading**: Root comments and replies
- **Rich status display**: File modifications, verifications, summaries

## Core Design Principles

1. **Interface-Based Design**: All I/O systems as traits/interfaces
2. **Implementation Agnostic**: Swappable implementations (Linear, CLI, HTTP, etc.)
3. **Testability First**: Integration tests using agnostic I/O (stdin/stdout, JSON, HTTP)
4. **Clean Separation**: Core logic never directly calls Linear or Claude APIs
5. **Renderer Pattern**: Output rendering completely decoupled from logic
6. **Language Agnostic Tests**: Tests work regardless of implementation language

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  (CLI App, Electron App, Server, Tests)                     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────┐
│                  Core Orchestration                          │
│  - AgentSessionOrchestrator (implementation-agnostic)       │
│  - Uses only abstract interfaces                             │
└───┬──────────────┬──────────────┬──────────────┬───────────┘
    │              │              │              │
    ▼              ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Agent   │  │  Issue   │  │ Renderer │  │   Storage    │
│ Runner  │  │ Tracker  │  │Interface │  │  Interface   │
│Interface│  │Interface │  │          │  │              │
└────┬────┘  └─────┬────┘  └─────┬────┘  └──────┬───────┘
     │             │              │              │
     │             │              │              │
     ▼             ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Claude  │  │  Linear  │  │  Linear  │  │  File-based  │
│ Runner  │  │  Impl.   │  │Renderer  │  │  Storage     │
└─────────┘  └──────────┘  └──────────┘  └──────────────┘
     │             │              │              │
     ▼             ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Cursor  │  │  GitHub  │  │   CLI    │  │  Database    │
│ Runner  │  │Issues Impl│  │Renderer  │  │  Storage     │
└─────────┘  └──────────┘  └──────────┘  └──────────────┘
                               │
                               ▼
                          ┌──────────┐
                          │   HTTP   │
                          │Renderer  │
                          └──────────┘
```

## Core Interfaces

### 1. AgentRunner Interface

```typescript
/**
 * Abstract interface for running AI agents (Claude, Cursor, etc.)
 */
interface AgentRunner {
  /**
   * Start a new agent session
   */
  start(config: AgentSessionConfig): Promise<AgentSession>

  /**
   * Send a message to a running session
   */
  sendMessage(sessionId: string, message: string): Promise<void>

  /**
   * Stop a running session
   */
  stop(sessionId: string): Promise<void>

  /**
   * Resume an existing session
   */
  resume(sessionId: string, config: AgentSessionConfig): Promise<AgentSession>

  /**
   * Check if session is running
   */
  isRunning(sessionId: string): boolean

  /**
   * Get session events stream
   */
  getEventStream(sessionId: string): AsyncIterable<AgentEvent>
}

interface AgentSessionConfig {
  workingDirectory: string
  prompt: string | AsyncIterable<UserMessage>
  systemPrompt?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  environment?: Record<string, string>
  maxTurns?: number
  model?: string
}

interface AgentSession {
  id: string
  startedAt: Date
  events: AsyncIterable<AgentEvent>
}

type AgentEvent =
  | { type: 'text', content: string }
  | { type: 'tool-use', tool: string, input: unknown }
  | { type: 'tool-result', tool: string, output: unknown }
  | { type: 'error', error: Error }
  | { type: 'complete', summary: SessionSummary }
```

### 2. IssueTracker Interface

```typescript
/**
 * Abstract interface for issue tracking systems (Linear, GitHub, Jira, etc.)
 */
interface IssueTracker {
  /**
   * Get issue by ID
   */
  getIssue(issueId: string): Promise<Issue>

  /**
   * List issues assigned to a specific member
   */
  listAssignedIssues(memberId: string, filters?: IssueFilters): Promise<Issue[]>

  /**
   * Update issue state
   */
  updateIssueState(issueId: string, state: IssueState): Promise<void>

  /**
   * Add comment to issue
   * Returns the complete Comment object with generated id
   * Agent sessions correspond to root comments (isRoot: true)
   */
  addComment(issueId: string, comment: Omit<Comment, 'id'>): Promise<Comment>

  /**
   * Get comments for issue
   */
  getComments(issueId: string): Promise<Comment[]>

  /**
   * Watch for issue updates
   */
  watchIssues(memberId: string): AsyncIterable<IssueEvent>

  /**
   * Get issue attachments
   */
  getAttachments(issueId: string): Promise<Attachment[]>

  /**
   * Send agent signal (start, stop, feedback)
   */
  sendSignal(issueId: string, signal: AgentSignal): Promise<void>

  /**
   * Get a member by their ID
   */
  getMember(memberId: string): Promise<Member>

  /**
   * List all available labels (optionally filtered by team)
   */
  listLabels(teamId?: string): Promise<Label[]>
}

interface Issue {
  id: string
  identifier: string  // e.g., "CYPACK-264"
  title: string
  description: string
  state: IssueState
  priority: number
  assignee?: Member
  labels: Label[]
  url: string
  createdAt: Date
  updatedAt: Date
}

interface IssueState {
  type: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  name: string
}

interface Comment {
  id?: string
  author: Member
  content: string
  createdAt: Date
  isRoot: boolean  // Root comments start new agent sessions, replies continue existing sessions
  parentId?: string // ID of parent comment if this is a reply
  updatedAt?: Date
}

interface Member {
  id: string
  name: string
  email?: string
}

type IssueEvent =
  | { type: 'assigned', issue: Issue }
  | { type: 'unassigned', issue: Issue }
  | { type: 'comment-added', issue: Issue, comment: Comment }
  | { type: 'state-changed', issue: Issue, oldState: IssueState, newState: IssueState }
  | { type: 'signal', issue: Issue, signal: AgentSignal }

type AgentSignal =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'feedback', message: string }
```

### 3. Renderer Interface

```typescript
/**
 * Abstract interface for rendering agent activity to users
 */
interface Renderer {
  /**
   * Render agent session start
   */
  renderSessionStart(session: RenderableSession): Promise<void>

  /**
   * Render agent activity/progress
   */
  renderActivity(sessionId: string, activity: AgentActivity): Promise<void>

  /**
   * Render agent text response
   */
  renderText(sessionId: string, text: string): Promise<void>

  /**
   * Render tool usage
   */
  renderToolUse(sessionId: string, tool: string, input: unknown): Promise<void>

  /**
   * Render session completion
   */
  renderComplete(sessionId: string, summary: SessionSummary): Promise<void>

  /**
   * Render error
   */
  renderError(sessionId: string, error: Error): Promise<void>

  /**
   * Get user input stream (for interactive renderers)
   */
  getUserInput(sessionId: string): AsyncIterable<UserInput>
}

interface RenderableSession {
  id: string
  issueId: string
  issueTitle: string
  startedAt: Date
}

type AgentActivity =
  | { type: 'thinking', message: string }
  | { type: 'file-modified', path: string, changes: number }
  | { type: 'verification', status: 'running' | 'passed' | 'failed', details: string }
  | { type: 'status', message: string }

type UserInput =
  | { type: 'message', content: string, attachments?: Attachment[] }
  | { type: 'signal', signal: AgentSignal }
```

### 4. Storage Interface

```typescript
/**
 * Abstract interface for persisting session state
 */
interface SessionStorage {
  /**
   * Save session state
   */
  saveSession(session: SessionState): Promise<void>

  /**
   * Load session state
   */
  loadSession(sessionId: string): Promise<SessionState | null>

  /**
   * List sessions for an issue
   */
  listSessions(issueId: string): Promise<SessionState[]>

  /**
   * Delete session
   */
  deleteSession(sessionId: string): Promise<void>
}

interface SessionState {
  id: string
  issueId: string
  agentSessionId: string
  startedAt: Date
  endedAt?: Date
  status: 'running' | 'completed' | 'failed' | 'stopped'
  messages: Message[]
  metadata: Record<string, unknown>
}
```

## Implementation Strategy

### Phase 1: Create Core Interfaces Package
- New package: `packages/interfaces/`
- Define all TypeScript interfaces
- Zero dependencies (pure types)
- Comprehensive JSDoc documentation

### Phase 2: Implement ClaudeRunner Adapter
- Wrap existing ClaudeRunner to implement AgentRunner interface
- New package: `packages/agent-runners/claude/`
- Maintain backward compatibility with existing code
- Add CursorRunner stub for future implementation

### Phase 3: Implement Linear Adapter
- Wrap Linear SDK to implement IssueTracker interface
- New package: `packages/issue-trackers/linear/`
- Abstract away all Linear-specific details
- Simplified API focused on Cyrus needs

### Phase 4: Implement Renderers
- LinearRenderer: Posts to Linear comments (existing behavior)
- CLIRenderer: Interactive terminal UI with TUI library
- Both in `packages/renderers/`

### Phase 5: Create Orchestrator
- New package: `packages/orchestrator/`
- Implementation-agnostic session management
- Uses only interfaces, never concrete implementations
- Coordinates AgentRunner, IssueTracker, Renderer, Storage

### Phase 6: Build Interactive Demo
- Build demo application to test renderer model
- Uses renderer to emulate Linear experience
- Proves renderer model works
- Shows agent activity in real-time

### Phase 7: Integration Testing Framework
- New package: `packages/integration-tests/`
- Uses stdin/stdout, JSON, HTTP for I/O
- Tests can run with any implementation
- Mock implementations for testing

### Phase 8: Update Existing Code
- Refactor EdgeWorker to use Orchestrator
- Update CLI app to use new architecture
- Maintain backward compatibility where possible

## CLI Interactive Demo Design

### Terminal UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Cyrus CLI - Issue: CYPACK-264                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Activity Panel]                                           │
│                                                              │
│  ● In Progress                                              │
│  │                                                           │
│  ├─ Cyrus                                     34 min ago    │
│  │  Summary                                                 │
│  │                                                           │
│  │  Completed CYPACK-264 orchestration with four major...  │
│  │                                                           │
│  │  ✓ Changes Made                                         │
│  │    • Added sub path explanation for repository...       │
│  │    • Implemented new config updater package...          │
│  │                                                           │
│  └─ [Show more]                                            │
│                                                              │
│  ● 34 previous replies - View all                          │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Input]                                                    │
│  Message Cyrus...                          [📎] [⏹ Stop]  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Controls:
  Ctrl+C: Exit
  ↑/↓: Scroll activity
  Tab: Focus input
  Ctrl+A: Add attachment
  Ctrl+S: Send stop signal
```

### Key Features

1. **Real-time Activity Updates**: Shows agent progress as it works
2. **Interactive Input**: Message field with attachment support
3. **Stop Control**: Ability to send stop signal
4. **Comment Threading**: Root comments and reply structure
5. **Status Display**: Rich status indicators (✓, ●, etc.)
6. **Scroll History**: View full conversation history

### Technology Stack for CLI Renderer

- **TUI Library**: `ink` (React for CLIs) or `blessed` (low-level)
- **Streaming**: Real-time updates via AgentEvent stream
- **Input Handling**: Readline interface for message input
- **File System**: Local storage for session state

## Testing Strategy

### Unit Tests
- Each interface implementation tested in isolation
- Mock dependencies via interfaces
- High coverage for adapters and renderers

### Integration Tests
- Use mock implementations of all interfaces
- Test Orchestrator with various scenarios
- Verify event flow and state management

### End-to-End Tests
- CLIRenderer with real AgentRunner (in test mode)
- LinearRenderer with Linear test workspace
- Full workflow from issue assignment to completion

### Language-Agnostic Tests
- HTTP-based test harness
- JSON input/output contracts
- Can be implemented in any language
- Validates system behavior, not implementation

## Migration Path

### Stage 1: Parallel Implementation (No Breaking Changes)
- New packages coexist with existing code
- EdgeWorker continues using existing services
- CLI app continues working as-is

### Stage 2: Incremental Adoption
- New features use new architecture
- Existing code gradually migrated
- Comprehensive testing at each step

### Stage 3: Full Migration
- EdgeWorker refactored to use Orchestrator
- Old service layer deprecated
- All I/O goes through interfaces

### Stage 4: Cleanup
- Remove old service implementations
- Consolidate packages
- Update documentation

## Success Criteria

1. **Abstraction Quality**
   - Zero Linear imports in core orchestration
   - Zero Claude imports in core orchestration
   - All I/O through interfaces

2. **Testability**
   - 90%+ test coverage on new code
   - Integration tests with mock implementations
   - Language-agnostic test suite

3. **CLI Demo**
   - Interactive CLI that emulates Linear experience
   - Shows real-time agent activity
   - Supports messaging and stop signals
   - Works with actual Claude sessions

4. **Backward Compatibility**
   - Existing Cyrus functionality unchanged
   - No breaking changes to public APIs
   - Migration path clearly documented

5. **Performance**
   - No performance degradation
   - Minimal memory overhead
   - Efficient event streaming

## Verification Instructions

After implementation, verification requires:

1. **Build System**
   ```bash
   cd /Users/agentops/code/cyrus-workspaces/CYPACK-264
   pnpm install
   pnpm build
   ```

2. **Run Tests**
   ```bash
   pnpm test:packages
   pnpm typecheck
   ```

3. **Demo Interactive Application**
   ```bash
   cd apps/browser-demo
   pnpm start
   ```

   Expected: Browser UI showing:
   - Activity panel with real-time updates
   - Input field for messaging
   - Stop button functionality
   - WebSocket-based real-time updates

4. **Integration Test**
   ```bash
   cd packages/integration-tests
   pnpm test:run
   ```

   Expected: All integration tests pass, demonstrating:
   - AgentRunner interface works
   - IssueTracker interface works
   - Renderer interface works
   - Orchestrator coordinates correctly

5. **Visual Evidence**
   - Screenshots of CLI interactive demo
   - Logs showing abstraction layers working
   - Test output showing all passes

## Next Steps

1. Get approval on architecture design
2. Create detailed task breakdown for implementation
3. Begin with interfaces package
4. Iteratively implement each phase
5. Continuous testing and validation
6. Documentation and examples throughout

---

**Document Version**: 1.0
**Created**: 2025-10-31
**Status**: Pending Review
