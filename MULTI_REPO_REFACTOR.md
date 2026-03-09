# Multi-Repository Refactor: Discovery Map & Design

## Current Architecture: Single-Repo Assumptions

### Layer 1: Core Types (packages/core)

| File | Location | Assumption | Classification |
|------|----------|-----------|----------------|
| `CyrusAgentSession.ts` | L42-103 | No `repositoryIds` field. Repo binding is external via EdgeWorker's `agentSessionManagers` map (repo ID → AgentSessionManager). | TYPE DEFINITION |
| `config-types.ts` | L114-117 | `handlers.createWorkspace` takes singular `repository: RepositoryConfig` | TYPE DEFINITION |
| `config-types.ts` | L120-124 | `handlers.onClaudeMessage` takes singular `repositoryId: string` | TYPE DEFINITION |
| `config-types.ts` | L127-130 | `handlers.onSessionStart` takes singular `repositoryId: string` | TYPE DEFINITION |
| `config-types.ts` | L133-138 | `handlers.onSessionEnd` takes singular `repositoryId: string` | TYPE DEFINITION |
| `PersistenceManager.ts` | L55-66 | `SerializableEdgeWorkerState.agentSessions` keyed by repo ID: `Record<string, Record<string, ...>>` | TYPE DEFINITION |
| `PersistenceManager.ts` | L64-65 | `issueRepositoryCache: Record<string, string>` maps issue→single repo | TYPE DEFINITION |

### Layer 2: EdgeWorker (packages/edge-worker/src/EdgeWorker.ts)

| Line(s) | Code | Assumption |
|---------|------|-----------|
| 170 | `agentSessionManagers: Map<string, AgentSessionManager>` | One AgentSessionManager PER repo |
| 171 | `issueTrackers: Map<string, IIssueTrackerService>` | One tracker PER repo |
| 282-288 | `hasActiveSession(issueId, repositoryId)` | Checks sessions in ONE repo's manager |
| 313-442 | Constructor repo loop | Creates one session manager, one issue tracker, one activity sink per repo |
| 542-553 | `initialize()` state restore | Iterates repos to restore per-repo sessions |
| 785 | Slack session MCP config | Uses "first repository's" Linear token |
| 951-964 | GitHub webhook handling | `findRepositoryByGitHubUrl` returns ONE repo |
| 2085 | `getCachedRepository()` | Returns singular `RepositoryConfig \| null` |
| 2310-2348 | `handleIssueUnassignment` | Looks up single cached repo |
| 2394-2411 | `handleIssueTitleOrDescriptionUpdate` | Looks up single cached repo |
| 2601-2676 | `createAgentSession()` | Takes singular `repository: RepositoryConfig` |
| 2700-2756 | `handleAgentSessionCreated()` | Routes to ONE repo, caches issue→repo |
| 3351-3430 | `initializeAgentRunner()` | Takes singular `repository: RepositoryConfig` |
| 3576-3690 | `handleAgentSessionPrompted()` | Looks up single cached repo |
| 3845-3946 | Prompt building methods | All take singular `repository` |
| 4440-4593 | `buildRunnerConfig()` | Takes singular `repository` |
| 4860-4962 | Tool building methods | Take singular `repository` |
| 5108-5160 | Model/MCP config | Uses singular `repository.model`, `repository.mcpConfigPath` |
| 5420-5489 | State serialization | Keys sessions by `repositoryId` |

### Layer 3: RepositoryRouter (packages/edge-worker/src/RepositoryRouter.ts)

| Line(s) | Code | Assumption |
|---------|------|-----------|
| 69-70 | `issueRepositoryCache = new Map<string, string>()` | Issue→single repo ID |
| 15-29 | `RepositoryRoutingResult` | Returns singular `repository: RepositoryConfig` |
| 95-119 | `getCachedRepository()` | Returns single repo |
| 130-304 | `determineRepositoryForWebhook()` | Returns ONE repo |

### Layer 4: AgentSessionManager (packages/edge-worker/src/AgentSessionManager.ts)

| Line(s) | Code | Assumption |
|---------|------|-----------|
| 92 | Comment: "CURRENTLY BEING HANDLED 'per repository'" | Explicitly per-repo |
| 94-134 | Constructor | Takes single activity sink (tied to one repo's issue tracker) |

### Layer 5: PromptBuilder & PromptAssembly

| File | Line(s) | Assumption |
|------|---------|-----------|
| `prompt-assembly/types.ts` | 77 | `PromptAssemblyInput.repository: RepositoryConfig` (singular) |
| `PromptBuilder.ts` | 83 | `determineSystemPrompt(labels, repository)` - singular |
| `PromptBuilder.ts` | 272 | `buildIssueContextPrompt(issue, repository)` - singular |
| `PromptBuilder.ts` | 669 | `buildSubroutinePrompt(issue, repository)` - singular |

### Layer 6: Supporting Services

| File | Location | Assumption |
|------|----------|-----------|
| `GitService.ts:229` | `createGitWorktree(issue, repository)` | Creates worktree from ONE repo |
| `RunnerSelectionService.ts:363` | `buildAllowedTools(repository)` | Builds tools for ONE repo |
| `RunnerSelectionService.ts:440` | `buildDisallowedTools(repository)` | Builds tools for ONE repo |
| `types.ts:13-41` | `EdgeWorkerEvents` | All events pass singular `repositoryId` |
| `ActivityPoster.ts` | Throughout | Keyed by `repositoryId` |
| `UserAccessControl.ts` | Throughout | Per-repo access configs |

### Layer 7: Apps

| File | Location | Assumption |
|------|----------|-----------|
| `apps/cli/` | Handler callbacks | `onSessionStart(issueId, issue, repositoryId)` - singular |
| `apps/proxy/` | Webhook forwarding | Routes to one repo |

---

## New Design: Multi-Repository Sessions

### Core Principle

A `CyrusAgentSession` can be associated with **0, 1, or N** repositories:
- **0 repos**: Standalone session (chat, question-answering, no code context)
- **1 repo**: Standard single-repo session (current common case)
- **N repos**: Cross-repo orchestration, multi-repo features

### CyrusAgentSession Changes

```typescript
export interface CyrusAgentSession {
  id: string;
  externalSessionId?: string;
  type: AgentSessionType.CommentThread;
  status: AgentSessionStatus;
  context: AgentSessionType.CommentThread;
  createdAt: number;
  updatedAt: number;
  issueContext?: IssueContext;
  issue?: IssueMinimal;

  /**
   * Repository IDs associated with this session.
   * - Empty array: standalone session (no repository context)
   * - Single entry: standard single-repo session
   * - Multiple entries: multi-repo session
   */
  repositoryIds: string[];

  workspace: Workspace;
  claudeSessionId?: string;
  geminiSessionId?: string;
  codexSessionId?: string;
  cursorSessionId?: string;
  agentRunner?: IAgentRunner;
  metadata?: { ... };
}
```

**Removed**: `issueId` deprecated field (clean break).

### EdgeWorker Architecture Changes

1. **Remove per-repo AgentSessionManagers**:
   - Old: `agentSessionManagers: Map<string, AgentSessionManager>` (repo ID → manager)
   - New: Single `AgentSessionManager` instance with `repositoryIds` passed per-session

2. **Keep per-repo issueTrackers** (still need per-workspace tokens):
   - `issueTrackers: Map<string, IIssueTrackerService>` stays

3. **Keep per-repo RepositoryConfig map**:
   - `repositories: Map<string, RepositoryConfig>` stays as a lookup table

4. **Remove issueRepositoryCache**:
   - Repo association lives on `CyrusAgentSession.repositoryIds`
   - Use `GlobalSessionRegistry` to look up sessions by issue context

5. **AgentSessionManager becomes singular**:
   - No longer instantiated per-repo
   - Activity sink resolved per-operation based on session's `repositoryIds`
   - Constructor takes a `getSink(repositoryId): IActivitySink` callback instead of a fixed sink

### RepositoryRouter Changes

```typescript
export type RepositoryRoutingResult =
  | { type: "selected"; repositories: RepositoryConfig[]; routingMethod: string }
  | { type: "needs_selection"; workspaceRepos: RepositoryConfig[] }
  | { type: "none" };
```

- Always returns array (may be empty, single, or multiple)
- Issue-to-repo cache removed (session owns repo association)

### Handler Signature Changes

All handler signatures that take singular `repository: RepositoryConfig` change to
`repositories: RepositoryConfig[]` or work from session's `repositoryIds`.

### EdgeWorkerRuntimeConfig Handler Changes

```typescript
handlers?: {
  createWorkspace?: (issue: Issue, repositories: RepositoryConfig[]) => Promise<Workspace>;
  onClaudeMessage?: (issueId: string, message: SDKMessage, repositoryIds: string[]) => void;
  onSessionStart?: (issueId: string, issue: Issue, repositoryIds: string[]) => void;
  onSessionEnd?: (issueId: string, exitCode: number | null, repositoryIds: string[]) => void;
};
```

### EdgeWorkerEvents Changes

```typescript
export interface EdgeWorkerEvents {
  "session:started": (issueId: string, issue: Issue, repositoryIds: string[]) => void;
  "session:ended": (issueId: string, exitCode: number | null, repositoryIds: string[]) => void;
  "claude:message": (issueId: string, message: SDKMessage, repositoryIds: string[]) => void;
  // ...
}
```

### Persistence Migration (v3.0 → v4.0)

Old format keys sessions by repo ID:
```json
{
  "agentSessions": {
    "repo-1": { "session-a": {...} },
    "repo-2": { "session-b": {...} }
  }
}
```

New format: sessions stored flat with `repositoryIds` on each:
```json
{
  "agentSessions": {
    "session-a": { "repositoryIds": ["repo-1"], ... },
    "session-b": { "repositoryIds": ["repo-2"], ... }
  }
}
```

Migration: iterate old repo-keyed structure, set `repositoryIds: [repoId]` on each session, flatten into single map.

### PromptAssemblyInput Changes

```typescript
export interface PromptAssemblyInput {
  session: CyrusAgentSession;
  fullIssue: Issue;
  repositories: RepositoryConfig[]; // was singular
  // ... rest unchanged
}
```

### GitService Changes

```typescript
createGitWorktree(issue: Issue, repositories: RepositoryConfig[]): Promise<Workspace>
```

For multi-repo: creates worktree from first/primary repo, with additional repos as allowed directories.
