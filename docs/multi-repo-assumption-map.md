# Multi-Repository Assumption Map

> **Goal:** Allow 0, 1, or N repositories per `CyrusAgentSession`. Remove ALL assumptions that a Linear issue maps to exactly one repository. No backwards-compatibility scatter — only a single migration in `PersistenceManager`.

---

## Meta-Process (Failure Prevention)

1. **Exhaustive Discovery** — every `.ts` file listed and checked (see checklists below)
2. **Single Source of Truth** — new model defined once in `core`, consumed everywhere
3. **Layer-by-Layer** — core → infrastructure → business logic → runners → transport → apps
4. **Type System as Guardrail** — change types first, let `tsc` find every callsite
5. **Test Parity** — update tests before or alongside source, `pnpm test:packages:run` after each layer
6. **No Compat Scatter** — one migration function in `PersistenceManager` for old → new
7. **Verification Checkpoints** — typecheck + test + review after each layer

---

## High-Level Architecture of the Current Assumption

```
Linear Issue ──(1:1)──▶ Repository ──(1:1)──▶ AgentSessionManager ──(1:N)──▶ CyrusAgentSession(s)
                                        │
                                        ├──(1:1)──▶ IIssueTrackerService
                                        ├──(1:1)──▶ GitService (workspace/worktree per issue)
                                        └──(1:1)──▶ PromptBuilder (repo-scoped prompts)
```

**The core assumption is: ONE issue → ONE repository → ONE set of sessions.**

This manifests in three interlocking patterns:

### Pattern A: Issue-to-Repository Cache (1:1 mapping)
- `RepositoryRouter.issueRepositoryCache: Map<string, string>` — maps issue ID to **single** repo ID
- Once a repo is selected for an issue, it's cached and never re-evaluated
- `PersistenceManager.SerializableEdgeWorkerState.issueRepositoryCache: Record<string, string>` — same 1:1

### Pattern B: Per-Repository Infrastructure (1:1 maps in EdgeWorker)
- `EdgeWorker.repositories: Map<string, RepositoryConfig>` — repo ID → config
- `EdgeWorker.agentSessionManagers: Map<string, AgentSessionManager>` — **one manager per repo**
- `EdgeWorker.issueTrackers: Map<string, IIssueTrackerService>` — **one tracker per repo**
- All three maps are keyed by repo ID and iterated together

### Pattern C: Repository-Scoped Operations
- Every webhook handler resolves to a **single** `repository: RepositoryConfig`
- `createAgentSession(issueId, repository)` — singular repository
- Session events (`session:started`, `session:ended`, `claude:message`) emit a **single** `repositoryId`
- Prompt building takes `repository: RepositoryConfig` (singular)
- Workspace/worktree creation takes `repository: RepositoryConfig` (singular)

---

## Detailed Assumption Map by File

### Layer 1: Core Types & Schemas (`packages/core/src/`)

#### `config-schemas.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 130-167 | `RepositoryConfigSchema` | Defines a single repository configuration object | **Foundation** — this schema itself is fine; the issue is how it's used (singular) |
| 176-244 | `EdgeConfigSchema.repositories: z.array(RepositoryConfigSchema)` | Config holds an array of repos — this is fine, it's the per-issue binding that's the problem | Low |

#### `config-types.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 112-138 | `EdgeWorkerRuntimeConfig.handlers` | All handlers take `repositoryId: string` (singular) — `onSessionStart`, `onSessionEnd`, `onClaudeMessage` | **High** — event signatures assume one repo per event |
| 114-117 | `createWorkspace?: (issue: Issue, repository: RepositoryConfig) => Promise<Workspace>` | Creates ONE workspace per issue per ONE repository | **High** |

#### `CyrusAgentSession.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 42-103 | `CyrusAgentSession` interface | **No repository field at all** — the repo binding is external (in the `agentSessionManagers` map keyed by repoId) | **Critical** — sessions don't know which repo(s) they belong to |
| 36-40 | `Workspace` interface | `path: string` — a single workspace path, tied to one repo | **High** |

#### `PersistenceManager.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 56-57 | `agentSessions?: Record<string, Record<string, ...>>` | Outer key is **repository ID** — sessions are grouped by single repo | **Critical** |
| 65 | `issueRepositoryCache?: Record<string, string>` | Issue ID → **single** repo ID | **Critical** |
| 179-191 | `migrateV2ToV3()` | Migration iterates `repoId → repoSessions` — assumes 1:1 | **Medium** (needs v3→v4 migration) |

#### `issue-tracker/types.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| ~687 | Routing configuration types | Routing resolves to ONE repo | **Medium** |

#### `logging/ILogger.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 13 | `repository?: string` | Logger context takes a single optional `repository` string | **Low** — can stay as-is for per-log-line context |

### Layer 2: Infrastructure (`packages/edge-worker/src/`)

#### `RepositoryRouter.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 15-29 | `RepositoryRoutingResult` | `type: "selected"` returns a **single** `repository: RepositoryConfig` | **Critical** — the router always picks ONE repo |
| 70 | `issueRepositoryCache = new Map<string, string>()` | Issue → single repo | **Critical** |
| 95-119 | `getCachedRepository()` | Returns **one** `RepositoryConfig \| null` | **Critical** |
| 130-304 | `determineRepositoryForWebhook()` | Entire routing algorithm returns ONE winner | **Critical** |
| 490-563 | `elicitUserRepositorySelection()` | Asks user to pick ONE repo | **Critical** |
| 599-639 | `selectRepositoryFromResponse()` | Returns ONE selected repo | **Critical** |

#### `EdgeWorker.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 169 | `repositories: Map<string, RepositoryConfig>` | Repo map itself is fine | Low |
| 170 | `agentSessionManagers: Map<string, AgentSessionManager>` | **ONE manager per repo** — sessions for a repo are scoped to that manager | **Critical** |
| 171 | `issueTrackers: Map<string, IIssueTrackerService>` | **ONE tracker per repo** | **Critical** |
| ~282-283 | `hasActiveSession: (issueId, repositoryId) => boolean` | Checks if issue has session in **a specific repo** | **High** |
| ~543-551 | First repo fallback for various operations | Takes `firstRepo` from `repositories.values()` | **Medium** |
| ~961 | `agentSessionManagers.get(repository.id)` | Gets THE manager for THE repo | **Critical** |
| ~1556-1563 | Loop over `agentSessionManagers` to find parent session | Iterates all repos to find which one holds the parent session | **High** — shows the pain of per-repo managers |
| ~2318-2324 | Recovery loop for unassignment | Iterates all repos to find which one holds the session for an issue | **High** |
| ~2398-2404 | Recovery loop for issue updates | Same pattern | **High** |
| ~3619-3628 | Recovery loop for prompted webhooks | Same pattern — plus caches the found repo | **High** |
| ~5421-5426 | `serializeState()` | Serializes sessions keyed by `repositoryId` | **Critical** |
| ~5453-5468 | `restoreState()` | Restores sessions per `repositoryId` | **Critical** |
| ~5514-5518, 5527-5531, 5541-5556 | Activity posting delegations | All take `repositoryId: string` | **High** |
| ~5757-5762, 5971-5976 | More activity methods | Same `repositoryId` pattern | **High** |
| ~5984-5986 | `getRepositoryPlatform(repositoryId)` | Single repo lookup | **Medium** |
| ~3954-3955 | Status endpoint | Reports one status per repo | **Low** |

#### `AgentSessionManager.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 92 | `"CURRENTLY BEING HANDLED 'per repository'"` | **Explicit documentation** of the assumption | **Critical** |
| 94 | Class extends EventEmitter | One instance per repository — sessions within are scoped to that repo | **Critical** |
| 97-98 | `sessions: Map<string, CyrusAgentSession>`, `entries: Map<string, CyrusAgentSessionEntry[]>` | Session storage is per-manager, which is per-repo | **Critical** |

#### `types.ts` (EdgeWorker types)
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 13-39 | `EdgeWorkerEvents` | All events (`session:started`, `session:ended`, `claude:message`, `claude:response`, `claude:tool-use`) take `repositoryId: string` as last parameter | **High** |
| 49-58 | `AgentSessionData` | No `repositoryId` field — the repo is determined before this data is created | **Medium** |

#### `ConfigManager.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 10-16 | `RepositoryChanges` | Lists added/modified/removed repos — this is fine for config changes | **Low** |
| 49 | `repositories: Map<string, RepositoryConfig>` | Reference to EdgeWorker's repo map — fine | **Low** |

#### `GitService.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| ~229 | `createWorkspace(issue, repository: RepositoryConfig)` | Creates workspace for ONE repo | **High** — multi-repo sessions need multiple workspaces |
| ~254-537 | Workspace creation logic | All path construction uses `repository.workspaceBaseDir`, `repository.repositoryPath`, `repository.baseBranch` | **High** |

#### `PromptBuilder.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 24-25 | `deps.repositories` and `deps.issueTrackers` | Takes full maps — fine | **Low** |
| 83 | `determineLabelBasedSystemPrompt(issue, labels, repository: RepositoryConfig)` | Single repo for prompt determination | **High** |
| 272 | `buildIssueContextPrompt(issue, labels, repository: RepositoryConfig)` | Single repo for context building | **High** |
| 521 | `generateRoutingContext(currentRepository: RepositoryConfig)` | Generates routing context relative to ONE current repo | **Medium** |
| 669 | `buildProcedureSubroutinePrompt(..., repository: RepositoryConfig)` | Single repo for subroutine | **High** |
| ~1241 | `determineBaseBranch(issue, repository: RepositoryConfig)` | Base branch for ONE repo | **High** |

#### `ActivityPoster.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 49, 72, 92, 145, 234, 260 | All methods take `repositoryId: string` | Always operates in context of a single repo | **High** |

#### `UserAccessControl.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 102, 160, 182 | Methods take `repositoryId: string` | Access control is per-repo | **Medium** |

#### `AttachmentService.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| — | Processes attachments for a session | Likely uses workspace path (single repo) | **Medium** |

#### `RunnerSelectionService.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| — | Selects runner based on repo config | Takes single `RepositoryConfig` | **Medium** |

#### `sinks/LinearActivitySink.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| — | Posts activities to Linear | Takes issue tracker from single repo context | **Medium** |

#### `SlackChatAdapter.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| — | Adapts Slack for chat sessions | Uses repository paths for chat context | **Low** |

### Layer 3: Runner Packages

#### `packages/claude-runner/src/ClaudeRunner.ts`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| Takes `workDir` and `allowedDirectories` | These come from a single repo's workspace | **Medium** — runners themselves are repo-agnostic; the caller scopes them |

#### `packages/gemini-runner/`, `packages/codex-runner/`, `packages/cursor-runner/`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| All runners take workspace path and config | Scoped by caller to single repo | **Medium** — same as claude-runner |

#### `packages/simple-agent-runner/`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| Lightweight runner abstraction | No direct repo assumption | **Low** |

### Layer 4: Transport Packages

#### `packages/linear-event-transport/`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| `LinearIssueTrackerService` | One instance per repo in current architecture | **Low** — transport itself doesn't assume single repo |

#### `packages/github-event-transport/`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| GitHub webhook types include `repository` field | This is the GitHub repo from the webhook, not Cyrus repo config | **Low** |

#### `packages/slack-event-transport/`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| Slack transport | No direct repo assumption | **None** |

### Layer 5: Config Updater

#### `packages/config-updater/src/handlers/repository.ts`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| Handles add/remove/update of individual repos in config | Each repo is an independent entry in the array | **Low** — this is about managing the config, not about issue→repo binding |

### Layer 6: Apps

#### `apps/cli/src/services/WorkerService.ts`
| Line(s) | Code | Assumption | Criticality |
|---------|------|-----------|-------------|
| 279 | `onSessionStart(issueId, _issue, repositoryId)` | Single repo per session event | **High** |
| 288 | `onSessionEnd(issueId, exitCode, repositoryId)` | Single repo per session event | **High** |

#### `apps/cli/src/Application.ts`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| Creates EdgeWorker with config | Passes repo array — fine | **Low** |

#### `apps/cli/src/commands/SelfAddRepoCommand.ts`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| Adds a single repo to config | Config management — fine | **Low** |

#### `apps/f1/server.ts`
| Finding | Assumption | Criticality |
|---------|-----------|-------------|
| F1 test server | Sets up repos for testing | **Low** |

---

## File-by-File Checklist

Every `.ts` file in the repository, with its multi-repo impact assessment.

### `packages/core/src/` (13 source files)

- [x] `CyrusAgentSession.ts` — **NEEDS CHANGE**: Add optional `repositoryIds: string[]` field
- [x] `PersistenceManager.ts` — **NEEDS CHANGE**: New state format, v3→v4 migration
- [x] `config-schemas.ts` — **NO CHANGE** (individual repo configs are fine)
- [x] `config-types.ts` — **NEEDS CHANGE**: Handler signatures to support multi-repo context
- [x] `agent-runner-types.ts` — **NO CHANGE** (runner interface is repo-agnostic)
- [x] `simple-agent-runner-types.ts` — **NO CHANGE**
- [x] `StreamingPrompt.ts` — **NO CHANGE**
- [x] `constants.ts` — **NO CHANGE**
- [x] `index.ts` — **UPDATE EXPORTS** if new types added
- [x] `issue-tracker/types.ts` — **REVIEW** for routing types
- [x] `issue-tracker/IIssueTrackerService.ts` — **NO CHANGE** (service is per-workspace, not per-repo)
- [x] `issue-tracker/IAgentEventTransport.ts` — **NO CHANGE**
- [x] `issue-tracker/AgentEvent.ts` — **NO CHANGE**
- [x] `issue-tracker/adapters/CLIEventTransport.ts` — **NO CHANGE**
- [x] `issue-tracker/adapters/CLIIssueTrackerService.ts` — **NO CHANGE**
- [x] `issue-tracker/adapters/CLIRPCServer.ts` — **NO CHANGE**
- [x] `issue-tracker/adapters/CLITypes.ts` — **NO CHANGE**
- [x] `issue-tracker/adapters/index.ts` — **NO CHANGE**
- [x] `issue-tracker/index.ts` — **NO CHANGE**
- [x] `messages/types.ts` — **NO CHANGE** (GitHub platform refs, not Cyrus repos)
- [x] `messages/platform-refs.ts` — **NO CHANGE**
- [x] `messages/IMessageTranslator.ts` — **NO CHANGE**
- [x] `messages/type-guards.ts` — **NO CHANGE**
- [x] `messages/index.ts` — **NO CHANGE**
- [x] `logging/ILogger.ts` — **NO CHANGE** (single `repository?` context is fine per log line)
- [x] `logging/Logger.ts` — **NO CHANGE**
- [x] `logging/index.ts` — **NO CHANGE**

### `packages/core/test/` (5 test files)

- [x] `PersistenceManager.migration.test.ts` — **NEEDS CHANGE**: Add v3→v4 migration test
- [x] `CLIIssueTrackerService.labels.test.ts` — **NO CHANGE**
- [x] `CLIRPCServer.ephemeral.test.ts` — **NO CHANGE**
- [x] `CLITypes.test.ts` — **NO CHANGE**
- [x] `logging/Logger.test.ts` — **NO CHANGE**

### `packages/edge-worker/src/` (20 source files)

- [x] `EdgeWorker.ts` — **MAJOR CHANGE**: Decouple agentSessionManagers from repo ID, change routing flow
- [x] `AgentSessionManager.ts` — **MAJOR CHANGE**: No longer "per repository", must be session-centric
- [x] `RepositoryRouter.ts` — **MAJOR CHANGE**: Return 0/1/N repos, new cache model
- [x] `types.ts` — **NEEDS CHANGE**: Event signatures for multi-repo
- [x] `GitService.ts` — **NEEDS CHANGE**: Support multi-repo workspaces
- [x] `PromptBuilder.ts` — **NEEDS CHANGE**: Accept multi-repo context
- [x] `ActivityPoster.ts` — **NEEDS CHANGE**: Multi-repo activity posting
- [x] `ConfigManager.ts` — **NO CHANGE** (manages config array, not issue→repo binding)
- [x] `UserAccessControl.ts` — **REVIEW**: Per-repo access control may need multi-repo check
- [x] `AttachmentService.ts` — **REVIEW**: May need multi-workspace support
- [x] `RunnerSelectionService.ts` — **REVIEW**: Runner selection may need multi-repo context
- [x] `ChatSessionHandler.ts` — **REVIEW**: Chat may span repos
- [x] `SlackChatAdapter.ts` — **REVIEW**: Slack chat repo scoping
- [x] `SharedApplicationServer.ts` — **NO CHANGE**
- [x] `SharedWebhookServer.ts` — **NO CHANGE**
- [x] `GlobalSessionRegistry.ts` — **REVIEW**: May need to be primary session store
- [x] `WorktreeIncludeService.ts` — **REVIEW**: Worktree includes may span repos
- [x] `AskUserQuestionHandler.ts` — **NO CHANGE**
- [x] `index.ts` — **UPDATE EXPORTS**
- [x] `procedures/ProcedureAnalyzer.ts` — **NO CHANGE** (analyzes issue content, not repo-specific)
- [x] `procedures/index.ts` — **NO CHANGE**
- [x] `procedures/registry.ts` — **NO CHANGE**
- [x] `procedures/types.ts` — **NO CHANGE**
- [x] `prompt-assembly/types.ts` — **REVIEW**: May reference single repo
- [x] `sinks/IActivitySink.ts` — **REVIEW**: Sink interface
- [x] `sinks/LinearActivitySink.ts` — **REVIEW**: Activity posting per repo
- [x] `sinks/NoopActivitySink.ts` — **NO CHANGE**
- [x] `sinks/index.ts` — **NO CHANGE**
- [x] `validation/ValidationLoopController.ts` — **NO CHANGE** (operates on session, not repo)
- [x] `validation/index.ts` — **NO CHANGE**
- [x] `validation/types.ts` — **NO CHANGE**

### `packages/edge-worker/test/` (35 test files)

- [x] `RepositoryRouter.test.ts` — **NEEDS CHANGE**: Multi-repo routing tests
- [x] `GitService.test.ts` — **NEEDS CHANGE**: Multi-workspace tests
- [x] `UserAccessControl.test.ts` — **REVIEW**
- [x] `WorktreeIncludeService.test.ts` — **REVIEW**
- [x] `GlobalSessionRegistry.test.ts` — **REVIEW**
- [x] `LinearActivitySink.test.ts` — **REVIEW**
- [x] `chat-sessions.test.ts` — **REVIEW**
- [x] `validation-loop.test.ts` — **NO CHANGE**
- [x] `version-extraction.test.ts` — **NO CHANGE**
- [x] `setup.ts` — **NO CHANGE**
- [x] `prompt-assembly-utils.ts` — **NEEDS CHANGE**: Test utility uses single repo
- [x] `prompt-assembly.*.test.ts` (9 files) — **NEEDS CHANGE**: Prompt tests reference single repo
- [x] `EdgeWorker.*.test.ts` (19 files) — **NEEDS CHANGE**: All EdgeWorker tests assume single repo per session
- [x] `AgentSessionManager.*.test.ts` (6 files) — **NEEDS CHANGE**: Session manager tests scoped per repo

### `packages/claude-runner/src/` (5 source files)

- [x] `ClaudeRunner.ts` — **NO CHANGE** (repo-agnostic, takes workDir)
- [x] `config.ts` — **NO CHANGE**
- [x] `formatter.ts` — **NO CHANGE**
- [x] `index.ts` — **NO CHANGE**
- [x] `types.ts` — **NO CHANGE**

### `packages/claude-runner/test/` (4 test files)

- [x] `ClaudeRunner.test.ts` — **NO CHANGE**
- [x] `config.test.ts` — **NO CHANGE**
- [x] `disallowed-tools.test.ts` — **NO CHANGE**
- [x] `tools/cyrus-tools/fs-extra-import.test.ts` — **NO CHANGE**

### `packages/gemini-runner/src/` (9 source files)

- [x] All files — **NO CHANGE** (repo-agnostic runner)

### `packages/gemini-runner/test/` (4 test files)

- [x] All files — **NO CHANGE**

### `packages/codex-runner/src/` (5 source files)

- [x] All files — **NO CHANGE** (repo-agnostic runner)

### `packages/codex-runner/test/` (4 test files)

- [x] All files — **NO CHANGE**

### `packages/cursor-runner/src/` (5 source files)

- [x] All files — **NO CHANGE** (repo-agnostic runner)

### `packages/cursor-runner/test/` (5 test files)

- [x] All files — **NO CHANGE**

### `packages/simple-agent-runner/src/` (5 source files)

- [x] All files — **NO CHANGE**

### `packages/simple-agent-runner/test/` (2 test files)

- [x] All files — **NO CHANGE**

### `packages/config-updater/src/` (7 source files)

- [x] `ConfigUpdater.ts` — **NO CHANGE**
- [x] `handlers/repository.ts` — **NO CHANGE** (adds/removes repos from config array)
- [x] `handlers/cyrusConfig.ts` — **NO CHANGE**
- [x] `handlers/cyrusEnv.ts` — **NO CHANGE**
- [x] `handlers/checkGh.ts` — **NO CHANGE**
- [x] `handlers/configureMcp.ts` — **NO CHANGE**
- [x] `handlers/testMcp.ts` — **NO CHANGE**
- [x] `types.ts` — **NO CHANGE**
- [x] `index.ts` — **NO CHANGE**

### `packages/config-updater/test/` (1 test file)

- [x] `handlers/checkGh.test.ts` — **NO CHANGE**

### `packages/mcp-tools/src/` (4 source files)

- [x] All files — **NO CHANGE** (MCP tools are session-scoped)

### `packages/mcp-tools/test/` (2 test files)

- [x] All files — **NO CHANGE**

### `packages/linear-event-transport/src/` (5 source files)

- [x] All files — **NO CHANGE** (transport is workspace-scoped, not repo-scoped)

### `packages/linear-event-transport/test/` (1 test file)

- [x] `LinearMessageTranslator.test.ts` — **NO CHANGE**

### `packages/github-event-transport/src/` (6 source files)

- [x] All files — **NO CHANGE** (GitHub transport deals with GitHub repos, not Cyrus repo config)

### `packages/github-event-transport/test/` (5 test files)

- [x] All files — **NO CHANGE**

### `packages/slack-event-transport/src/` (6 source files)

- [x] All files — **NO CHANGE**

### `packages/slack-event-transport/test/` (4 test files)

- [x] All files — **NO CHANGE**

### `packages/cloudflare-tunnel-client/src/` (4 source files)

- [x] All files — **NO CHANGE**

### `apps/cli/src/` (12 source files)

- [x] `Application.ts` — **NO CHANGE** (passes config to EdgeWorker)
- [x] `app.ts` — **NO CHANGE**
- [x] `services/WorkerService.ts` — **NEEDS CHANGE**: Event handlers take `repositoryId`
- [x] `services/ConfigService.ts` — **NO CHANGE**
- [x] `services/Logger.ts` — **NO CHANGE**
- [x] `commands/StartCommand.ts` — **NO CHANGE**
- [x] `commands/SelfAddRepoCommand.ts` — **NO CHANGE**
- [x] `commands/SelfAuthCommand.ts` — **NO CHANGE**
- [x] `commands/AuthCommand.ts` — **NO CHANGE**
- [x] `commands/CheckTokensCommand.ts` — **NO CHANGE**
- [x] `commands/RefreshTokenCommand.ts` — **NO CHANGE**
- [x] `commands/ICommand.ts` — **NO CHANGE**
- [x] `config/constants.ts` — **NO CHANGE**
- [x] `config/types.ts` — **NO CHANGE**
- [x] `ui/CLIPrompts.ts` — **NO CHANGE**

### `apps/cli/` (2 test files)

- [x] `app.test.ts` — **REVIEW**
- [x] `src/commands/SelfAddRepoCommand.test.ts` — **NO CHANGE**
- [x] `src/commands/SelfAuthCommand.test.ts` — **NO CHANGE**

### `apps/f1/` (13 source files)

- [x] `server.ts` — **REVIEW**: F1 test server repo setup
- [x] `src/cli.ts` — **NO CHANGE**
- [x] `src/commands/*.ts` (10 command files) — **NO CHANGE** (F1 commands are test tooling)
- [x] `src/templates/index.ts` — **NO CHANGE**
- [x] `src/utils/*.ts` (3 utility files) — **NO CHANGE**

---

## Summary: Files Requiring Changes

### Critical (must change — the core assumption lives here)

1. **`packages/core/src/CyrusAgentSession.ts`** — Add `repositoryIds?: string[]`
2. **`packages/core/src/PersistenceManager.ts`** — New state schema, v3→v4 migration
3. **`packages/core/src/config-types.ts`** — Handler signatures
4. **`packages/edge-worker/src/EdgeWorker.ts`** — Central orchestrator, biggest change
5. **`packages/edge-worker/src/AgentSessionManager.ts`** — Decouple from single repo
6. **`packages/edge-worker/src/RepositoryRouter.ts`** — Multi-repo routing results

### High (directly affected, significant changes)

7. **`packages/edge-worker/src/types.ts`** — Event signatures
8. **`packages/edge-worker/src/GitService.ts`** — Multi-workspace creation
9. **`packages/edge-worker/src/PromptBuilder.ts`** — Multi-repo prompt context
10. **`packages/edge-worker/src/ActivityPoster.ts`** — Multi-repo activity posting
11. **`apps/cli/src/services/WorkerService.ts`** — Event handlers

### Medium (need review and likely adjustment)

12. **`packages/edge-worker/src/UserAccessControl.ts`**
13. **`packages/edge-worker/src/RunnerSelectionService.ts`**
14. **`packages/edge-worker/src/GlobalSessionRegistry.ts`**
15. **`packages/edge-worker/src/AttachmentService.ts`**
16. **`packages/edge-worker/src/WorktreeIncludeService.ts`**
17. **`packages/edge-worker/src/sinks/LinearActivitySink.ts`**

### Tests (must be updated to match source changes)

18-50+. All `packages/edge-worker/test/` files that reference repositories
51. `packages/core/test/PersistenceManager.migration.test.ts`
52. `apps/cli/app.test.ts`

---

## Transformation Strategy (Layer Order)

### Phase 1: Core Types
- Add `repositoryIds?: string[]` to `CyrusAgentSession`
- Change `issueRepositoryCache` from `Record<string, string>` to `Record<string, string[]>`
- Update `PERSISTENCE_VERSION` to `"4.0"`, add v3→v4 migration
- Update handler signatures in `config-types.ts`

### Phase 2: Infrastructure
- `RepositoryRouter`: Return `RepositoryConfig[]` instead of single `RepositoryConfig`
- `AgentSessionManager`: Remove per-repo coupling — sessions carry their own repo context
- `EdgeWorker`: Replace per-repo maps with session-centric architecture

### Phase 3: Business Logic
- `PromptBuilder`: Accept `repositories: RepositoryConfig[]` for multi-repo context
- `GitService`: Support creating workspaces across multiple repos
- `ActivityPoster`: Route activities to correct tracker(s)

### Phase 4: Events & CLI
- Update `EdgeWorkerEvents` signatures
- Update `WorkerService` event handlers

### Phase 5: Tests
- Update all affected test files

### Phase 6: Verification
- `pnpm typecheck`
- `pnpm test:packages:run`
- `pnpm build`
- F1 test drive
