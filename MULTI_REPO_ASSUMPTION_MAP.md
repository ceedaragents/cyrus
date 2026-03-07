# Multi-Repository Support: Assumption Map

## Summary

This document maps every location in the `cyrus` codebase where a **single-repository-per-issue/session** assumption exists. The goal is to change `CyrusAgentSession` to support **0, 1, or N repositories**.

---

## HIGH-LEVEL Assumption Categories

### 1. `issueRepositoryCache: Map<string, string>` (issueId → single repoId)
The cache maps each issue to exactly ONE repository. Must become `Map<string, string[]>`.

### 2. `agentSessionManagers: Map<string, AgentSessionManager>` (repoId → manager)
One AgentSessionManager per repository. Sessions are looked up by knowing which repo they belong to. A multi-repo session would need to span managers or the keying strategy changes.

### 3. `RepositoryRouter.determineRepositoryForWebhook()` returns a single repo
The routing logic produces one `RepositoryConfig`. Must support returning multiple.

### 4. `repository: RepositoryConfig` parameter threading
Dozens of methods in EdgeWorker pass a single `repository` through the call chain. Must become `repositories: RepositoryConfig[]`.

### 5. `CyrusAgentSession` has no `repositories` field
The session type has no concept of which repositories it's associated with.

### 6. Handler callbacks in `EdgeWorkerRuntimeConfig` take single `repositoryId`
`onSessionStart`, `onSessionEnd`, `onClaudeMessage`, `createWorkspace` all reference a single repo.

### 7. Persistence state `issueRepositoryCache: Record<string, string>`
Must become `Record<string, string[]>`.

---

## DETAILED File-by-File Map

### packages/core/src/CyrusAgentSession.ts
- **No `repositories` field** on `CyrusAgentSession` interface (line 42-103)
- Session has no way to indicate which repos it works in

### packages/core/src/config-types.ts
- **Line 114-118**: `createWorkspace` handler takes single `repository: RepositoryConfig`
- **Line 120-124**: `onClaudeMessage` handler takes single `repositoryId: string`
- **Line 127-131**: `onSessionStart` handler takes single `repositoryId: string`
- **Line 133-138**: `onSessionEnd` handler takes single `repositoryId: string`

### packages/core/src/config-schemas.ts
- No direct single-repo assumption (schemas define repo configs, which is fine)

### packages/core/src/PersistenceManager.ts
- **Line 65**: `issueRepositoryCache?: Record<string, string>` — single repoId per issue
- **Line 57**: `agentSessions` keyed by repository ID (assumes 1 repo per session grouping)

### packages/edge-worker/src/RepositoryRouter.ts
- **Line 70**: `issueRepositoryCache = new Map<string, string>()` — single repo per issue
- **Line 95-119**: `getCachedRepository()` returns single `RepositoryConfig | null`
- **Line 130-304**: `determineRepositoryForWebhook()` returns single selected repo
- **Line 599-639**: `selectRepositoryFromResponse()` returns single repo
- **Line 726-734**: `getIssueRepositoryCache()`/`restoreIssueRepositoryCache()` — single-value maps

### packages/edge-worker/src/EdgeWorker.ts
- **Line 170**: `agentSessionManagers: Map<string, AgentSessionManager>` — 1 manager per repo
- **Line 2608**: `createLinearAgentSession()` takes single `repository: RepositoryConfig`
- **Line 2704**: `let repository: RepositoryConfig | null = null` — finds ONE repo
- **Line 2747-2749**: `cache.set(issueId, repository.id)` — caches single repo
- **Line 2808**: `initializeAgentRunner()` takes single `repository: RepositoryConfig`
- **Line 3611**: `getCachedRepository(issueId)` — returns single repo
- **Line 3624-3626**: Fallback: `cache.set(issueId, repoId)` — caches single repo
- **Line 5434-5442**: Serialization of `issueRepositoryCache` as single-value
- **Line 5485-5487**: Restoration of `issueRepositoryCache` as single-value
- Many methods take `repository: RepositoryConfig`:
  - `handleNormalPromptedActivity` (3700)
  - `handleIssueUnassigned` (3849)
  - `handleIssueTitleOrDescriptionUpdate` (3879)
  - `buildSystemPrompt` (3932)
  - `startAgentRunner` (4134)
  - `determineToolRestrictions` (4440)
  - `buildAllowedTools` (4487)
  - `buildDisallowedTools` (4593)
  - `downloadIssueAttachments` (4860, 4874)
  - `loadMcpConfigs` (4962)
  - `resolveRunnerAndModel` (5229)
  - `resolveModel` (5267)
  - `postInstantAcknowledgment` (5308)
  - `postRepositorySelectionActivity` (5336)
  - `notifyRunnerForNewComment` (5570)
  - `fetchFullIssueDetails` (5679)
  - `moveIssueToStartedState` (5779)

### packages/edge-worker/src/types.ts
- **Line 13-17**: `session:started` event takes single `repositoryId: string`
- **Line 18-22**: `session:ended` event takes single `repositoryId: string`
- **Line 25-29**: `claude:message` event takes single `repositoryId: string`
- **Line 30-34**: `claude:response` event takes single `repositoryId: string`
- **Line 35-40**: `claude:tool-use` event takes single `repositoryId: string`

### packages/edge-worker/src/PromptBuilder.ts
- **Lines 83, 272, 669, 1241, 1344**: Methods take single `repository: RepositoryConfig`

### packages/edge-worker/src/RunnerSelectionService.ts
- **Lines 363, 440**: Methods take single `repository: RepositoryConfig`

### packages/edge-worker/src/GitService.ts
- **Line 229**: `createGitWorktree()` takes single `repository: RepositoryConfig`

### packages/edge-worker/src/AttachmentService.ts
- **Line 41**: Method takes single `repository: RepositoryConfig`

### packages/edge-worker/src/prompt-assembly/types.ts
- **Line 77**: `repository: RepositoryConfig` in prompt assembly context

### packages/edge-worker/src/sinks/LinearActivitySink.ts
- Likely takes repositoryId for activity posting

### apps/cli/src/services/WorkerService.ts
- **Line 238**: `createWorkspace` handler takes single `repository: RepositoryConfig`

### apps/f1/server.ts
- **Line 90**: Creates single `repository: RepositoryConfig` for test

### packages/config-updater/src/handlers/repository.ts
- Handles repository CRUD (this is config-level, not per-session, but worth checking)

---

## Migration Strategy

### New Persistence Version: v3.0 → v4.0
- `issueRepositoryCache: Record<string, string>` → `Record<string, string[]>`
- Migration: wrap each single string value in an array

### No Backwards Compatibility Scattered Throughout
- Single migration in PersistenceManager
- All code uses new types directly
