# Repository Association Audit

Committed audit artifact for feature `audit-repository-association-assumptions`. This file is the repo-wide assumption map and checklist-backed design handoff for the `0/1/N` repository-association refactor.

## Validation coverage

- `VAL-AUDIT-001` — covered by the high-level categories and detailed file/path findings below.
- `VAL-AUDIT-002` — covered by the explicit per-directory checklist and exclusion rationale for the full repository scope.
- `VAL-AUDIT-003` — covered by the target-model and steady-state `source of truth` section.
- `VAL-AUDIT-004` — covered by the explicit `migration-only` boundary for legacy repo-first containers.

## Audit method

- Reviewed **414** in-scope repository files using path inventory plus targeted searches for `primary repository`, `current repository`, `issueRepositoryCache`, `agentSessions`, `agentSessionEntries`, `workspace.path`, `repository selection`, and `workspace-fallback`.
- Read the key runtime, persistence, prompt, validation, and mission library files to distinguish direct assumption sites from indirect coupling and unaffected surfaces.
- Checklist legend: `D` = direct single-primary-repository assumption site, `I` = indirect coupling / migration-boundary surface, `U` = reviewed and unaffected for this audit, `X` = excluded generated/vendor/symlink-only path with rationale.

## High-level assumption categories

| Category | What remains | Representative paths |
| --- | --- | --- |
| Persistence containers | The persisted EdgeWorker state is still repo-keyed (`agentSessions`, `agentSessionEntries`) and still carries a singular `issueRepositoryCache`. | `packages/core/src/PersistenceManager.ts`, `packages/core/test/PersistenceManager.migration.test.ts`, `packages/edge-worker/src/EdgeWorker.ts` |
| Routing and selection fallback | Routing still treats one repository as the fallback/current answer for an issue or prompted session. | `packages/edge-worker/src/RepositoryRouter.ts`, `packages/edge-worker/src/EdgeWorker.ts`, `packages/CLAUDE.md`, `packages/edge-worker/test/EdgeWorker.missing-session-recovery.test.ts` |
| Prompt and orchestration wording | Prompt assembly still chooses a representative repository and labels it as current. | `packages/edge-worker/src/PromptBuilder.ts`, `packages/edge-worker/prompts/orchestrator.md`, `packages/edge-worker/test/prompt-assembly.routing-context.test.ts` |
| Runtime ownership coupling | Several runtime APIs are still repo-scoped (`repositoryId`, per-repository manager ownership). These are acceptable only as derived/scoped operational handles, not as the steady-state authority. | `packages/edge-worker/src/AgentSessionManager.ts`, `packages/edge-worker/src/ActivityPoster.ts`, `packages/edge-worker/src/GlobalSessionRegistry.ts`, `packages/edge-worker/src/types.ts` |
| F1 / validation copy | The multi-repo validation fixture still names a primary/current repository and demonstrates selection with that language. | `apps/f1/server.ts`, `apps/f1/test-drives/2026-01-13-multi-repo-orchestration.md` |
| Reviewed unaffected surfaces | Root docs, CLI config/docs, transport/runner packages, scripts, and most tests do not encode a remaining single-primary-repository assumption. | `README.md`, `docs/*`, `apps/cli/*`, most packages outside `core` and `edge-worker` |

## Detailed file-level findings

### D1. Repo-keyed persistence is still authoritative today

- `packages/core/src/PersistenceManager.ts:56-65` defines `agentSessions` and `agentSessionEntries` keyed by repository id and preserves a singular `issueRepositoryCache` for repository recovery.
- `packages/core/src/PersistenceManager.ts:173-193` migrates v2 state by iterating repo buckets, which means the migration logic still assumes repo-first ownership even while renaming session ids.
- `packages/core/test/PersistenceManager.migration.test.ts:37-62` hard-codes repo-keyed persisted fixtures and asserts restore via `result.agentSessions["repo-1"]...`, confirming the assumption is encoded in tests as well as runtime.
- `packages/edge-worker/src/EdgeWorker.ts:5411-5489` serializes/restores session state by iterating `agentSessionManagers` per repository, then restores the singular issue-to-repository cache into `RepositoryRouter`.

### D2. Routing and prompted-session recovery still collapse to one repository

- `packages/edge-worker/src/RepositoryRouter.ts:69-118` stores one cached repository id per issue (`issueRepositoryCache`).
- `packages/edge-worker/src/RepositoryRouter.ts:131-160` and `:292-299` return `workspace-fallback` / first-workspace-repo selections, which makes the first repository authoritative when routing is ambiguous or underspecified.
- `packages/CLAUDE.md:38-44` documents the same behavior explicitly: prompted flows can ignore the selection and still continue via the fallback repo / issue-to-repository cache.
- `packages/edge-worker/src/EdgeWorker.ts:3230-3285` treats repository selection as choosing exactly one repository, then caches that single repository for the issue.
- `packages/edge-worker/src/EdgeWorker.ts:3589-3664` handles prompted continuation by consulting the singular cache first and then searching repo-owned managers as a recovery path.
- `packages/edge-worker/test/EdgeWorker.missing-session-recovery.test.ts:313-470` encodes missing-cache recovery and fallback-repository behavior as expected runtime behavior.
- `packages/edge-worker/test/RepositoryRouter.test.ts:308-345`, `:1213-1279`, and `:1362-1516` snapshot singular cached-repository behavior, pending selection cleanup, and workspace fallback semantics.

### D3. Prompt/orchestrator copy still implies one current repository

- `packages/edge-worker/src/PromptBuilder.ts:451-568` acknowledges there may be no single current repository context, yet still requires a `currentRepository` input and annotates one listed repository with `(current)`.
- `packages/edge-worker/prompts/orchestrator.md:82` says that when no routing context is present, all sub-issues will be handled in the current repository.
- `packages/edge-worker/test/prompt-assembly.routing-context.test.ts:159-189` asserts a literal `(current)` marker in the routing-context prompt snapshot, so the wording is locked in by tests.

### D4. F1 validation assets still teach a primary/current mental model

- `apps/f1/server.ts:101-151` names the first F1 repo with `primary` / `main-repo` routing labels and `PRIMARY` team keys, which makes the fixture itself teach a primary-repository concept.
- `apps/f1/test-drives/2026-01-13-multi-repo-orchestration.md:128-159` says `F1 Test Repository (primary/current)` and uses a repository-selection response containing `the primary repository`.

### I1. Runtime APIs and docs are repo-scoped but should become derived/scoped, not authoritative

- `packages/edge-worker/src/AgentSessionManager.ts:76-89` still carries the comment `CURRENTLY BEING HANDLED per repository`, even though the actual session ids are globally unique.
- `packages/edge-worker/src/ActivityPoster.ts` and `packages/edge-worker/src/types.ts` require `repositoryId` for posting events and emitting callbacks. That is acceptable as a scoped runtime action handle, but it must be resolved from explicit session associations rather than treated as the session identity source.
- `packages/edge-worker/src/GlobalSessionRegistry.ts` is already session-id keyed and therefore a likely storage primitive for the refactor, but it currently lacks first-class repository-association records.
- `packages/core/src/config-schemas.ts` / `packages/core/src/config-types.ts` define repository/workspace configuration and `createWorkspace(issue, repository)` execution inputs. These remain necessary, but they are configuration-time inputs, not the steady-state session association source of truth.
- `packages/edge-worker/README.md`, `packages/README.md`, `apps/f1/README.md`, and `apps/cli/repositories.example.json` were reviewed as user-facing or integration-facing surfaces. They are already multi-repo aware, but later workers should align their wording with the normalized association model once runtime behavior changes land.

## Target model and migration boundary

### Steady-state source of truth

The steady-state **source of truth** should be an explicit repository-association collection stored on each `CyrusAgentSession` and persisted in a session-keyed normalized store. The authoritative question becomes **“which repository-association records belong to this session?”**, not **“which repository bucket contains this session?”**.

Conceptual steady-state shape:

```ts
type RepositoryAssociation = {
  repositoryId: string;
  linearWorkspaceId: string;
  associationOrigin:
    | "description-tag"
    | "label-based"
    | "project-based"
    | "team-based"
    | "team-prefix"
    | "catch-all"
    | "user-selected"
    | "restored";
  status: "selected" | "active" | "complete";
  executionContext?: {
    workspacePath: string;
    isGitWorktree: boolean;
    historyPath?: string;
  };
};

type RepositorySelectionState = {
  status: "unresolved" | "selection-required" | "resolved";
  candidateRepositoryIds: string[];
  reason?: "no-match" | "ambiguous" | "restored";
};

type CyrusAgentSession = {
  id: string;
  issueContext?: IssueContext;
  repositoryAssociations: RepositoryAssociation[];
  repositorySelectionState?: RepositorySelectionState;
  // optional session.workspace may remain only as last execution location, never as repository identity
};
```

- **Zero associations** = `repositoryAssociations: []` with explicit unresolved/selection-required state instead of silently picking a repository.
- **One association** = exactly one `RepositoryAssociation` record; no separate `primaryRepository` shortcut is needed.
- **Many associations** = multiple records, one per participating repository, each carrying its own scoped execution metadata if needed.
- If a singular `workspace` field survives the refactor, it must be documented as execution-location convenience only. Repository identity lives in `repositoryAssociations`, not `workspace.path`.

### Persisted ownership boundary

- Persist the latest format in **session-keyed** containers (for example `sessionsById`, `entriesBySessionId`, and any derived indexes) rather than repo-keyed outer maps.
- Runtime indexes such as `repoId -> sessionIds`, `issueId -> sessionIds`, or active-runner lookups may still exist for performance/operational reasons, but they must be rebuildable from the session record plus its repository-association set.
- Repo-scoped APIs such as `ActivityPoster.postComment(..., repositoryId)` and repo-specific event callbacks can remain, but they must be treated as scoped interaction channels, not as the authority for which repositories the session belongs to.

### Migration-only boundary

The following legacy repo-first containers are **migration-only** inputs and should be demoted permanently once the refactor lands:

- repo-keyed `agentSessions`
- repo-keyed `agentSessionEntries`
- singular `issueRepositoryCache` mappings
- repo-owned `agentSessionManagers` used as persistence/ownership authority
- fallback-to-first-repository rules (`workspace-fallback`, fallback repo, `(current)` prompt copy) that encode repository identity outside the normalized association records

Migration rule: load those shapes **once** at the persistence boundary, produce the latest normalized `CyrusAgentSession` records, save only the latest normalized format, and avoid any steady-state runtime branch that consults the legacy shapes afterward. Legacy repo-first containers are therefore **migration-only**, not authoritative runtime state.

## Full repository checklist

Checklist summary: **15 direct assumption sites**, **14 indirect coupling surfaces**, **385 reviewed unaffected files** across **414** in-scope files.

### Excluded paths with rationale

- [x] `X` `AGENTS.md` — symlink to `CLAUDE.md`; reviewed via the canonical file.
- [x] `X` `.git/**` — VCS internals, not mission/product source files.
- [x] `X` `**/node_modules/**` — vendored dependencies.
- [x] `X` `**/dist/**` — generated build output.
- [x] `X` `**/.vite/**` — generated Vitest cache/results.
- [x] `X` `coverage/**` — generated coverage output.
- [x] `X` `.husky/_/**` — Husky-generated shim scripts; the canonical repo hook reviewed in-scope is `.husky/pre-commit`.
- [x] `X` `.codex/skills/f1-test-drive` and `.opencode/skills/f1-test-drive` — symlink-only harness wrappers pointing at `skills/f1-test-drive/SKILL.md`, reviewed via the canonical target.

### Checklist: `(repo root)` (14 files)
- [x] `U` `.gitignore`
- [x] `U` `CHANGELOG.internal.md`
- [x] `U` `CHANGELOG.md`
- [x] `U` `CLAUDE.md`
- [x] `U` `CONTRIBUTING.md`
- [x] `U` `LICENSE`
- [x] `U` `README.md`
- [x] `U` `biome.json`
- [x] `U` `cyrus-setup.sh`
- [x] `U` `package-lock.json`
- [x] `U` `package.json`
- [x] `U` `pnpm-lock.yaml`
- [x] `U` `pnpm-workspace.yaml`
- [x] `U` `tsconfig.base.json`

### Checklist: `.claude` (3 files)
- [x] `U` `.claude/agents/f1-test-drive.md`
- [x] `U` `.claude/skills/google/SKILL.md`
- [x] `U` `.claude/skills/release/SKILL.md`

### Checklist: `.factory` (8 files)
- [x] `U` `.factory/init.sh`
- [x] `D` `.factory/library/architecture.md`
- [x] `U` `.factory/library/environment.md`
- [x] `D` `.factory/library/repository-association-audit.md`
- [x] `I` `.factory/library/user-testing.md`
- [x] `U` `.factory/services.yaml`
- [x] `I` `.factory/skills/analysis-worker/SKILL.md`
- [x] `I` `.factory/skills/session-model-worker/SKILL.md`

### Checklist: `.github` (3 files)
- [x] `U` `.github/actions/install-dependencies/action.yml`
- [x] `U` `.github/copilot-instructions.md`
- [x] `U` `.github/workflows/ci.yml`

### Checklist: `.husky` (1 files)
- [x] `U` `.husky/pre-commit`

### Checklist: `.vscode` (2 files)
- [x] `U` `.vscode/extensions.json`
- [x] `U` `.vscode/settings.json`

### Checklist: `apps/cli` (26 files)
- [x] `U` `apps/cli/.gitignore`
- [x] `U` `apps/cli/.npmignore`
- [x] `U` `apps/cli/README.md`
- [x] `U` `apps/cli/agent-prompt-template.md`
- [x] `U` `apps/cli/app.test.ts`
- [x] `U` `apps/cli/package.json`
- [x] `I` `apps/cli/repositories.example.json`
- [x] `U` `apps/cli/src/Application.ts`
- [x] `U` `apps/cli/src/app.ts`
- [x] `U` `apps/cli/src/commands/AuthCommand.ts`
- [x] `U` `apps/cli/src/commands/CheckTokensCommand.ts`
- [x] `U` `apps/cli/src/commands/ICommand.ts`
- [x] `U` `apps/cli/src/commands/RefreshTokenCommand.ts`
- [x] `U` `apps/cli/src/commands/SelfAddRepoCommand.test.ts`
- [x] `U` `apps/cli/src/commands/SelfAddRepoCommand.ts`
- [x] `U` `apps/cli/src/commands/SelfAuthCommand.test.ts`
- [x] `U` `apps/cli/src/commands/SelfAuthCommand.ts`
- [x] `U` `apps/cli/src/commands/StartCommand.ts`
- [x] `U` `apps/cli/src/config/constants.ts`
- [x] `U` `apps/cli/src/config/types.ts`
- [x] `U` `apps/cli/src/services/ConfigService.ts`
- [x] `U` `apps/cli/src/services/Logger.ts`
- [x] `U` `apps/cli/src/services/WorkerService.ts`
- [x] `U` `apps/cli/src/ui/CLIPrompts.ts`
- [x] `U` `apps/cli/tsconfig.json`
- [x] `U` `apps/cli/vitest.config.ts`

### Checklist: `apps/f1` (40 files)
- [x] `U` `apps/f1/.gitignore`
- [x] `U` `apps/f1/CLAUDE.md`
- [x] `I` `apps/f1/README.md`
- [x] `U` `apps/f1/f1`
- [x] `U` `apps/f1/package.json`
- [x] `D` `apps/f1/server.ts`
- [x] `U` `apps/f1/src/cli.ts`
- [x] `U` `apps/f1/src/commands/assignIssue.ts`
- [x] `U` `apps/f1/src/commands/createComment.ts`
- [x] `U` `apps/f1/src/commands/createIssue.ts`
- [x] `U` `apps/f1/src/commands/initTestRepo.ts`
- [x] `U` `apps/f1/src/commands/ping.ts`
- [x] `U` `apps/f1/src/commands/promptSession.ts`
- [x] `U` `apps/f1/src/commands/startSession.ts`
- [x] `U` `apps/f1/src/commands/status.ts`
- [x] `U` `apps/f1/src/commands/stopSession.ts`
- [x] `U` `apps/f1/src/commands/version.ts`
- [x] `U` `apps/f1/src/commands/viewSession.ts`
- [x] `U` `apps/f1/src/templates/index.ts`
- [x] `U` `apps/f1/src/utils/colors.ts`
- [x] `U` `apps/f1/src/utils/output.ts`
- [x] `U` `apps/f1/src/utils/rpc.ts`
- [x] `U` `apps/f1/test-drives/002-unit-tests-rate-limiter.md`
- [x] `U` `apps/f1/test-drives/003-git-worktree-fix-verification.md`
- [x] `U` `apps/f1/test-drives/004-validation-loop-planted-bug.md`
- [x] `U` `apps/f1/test-drives/005-stop-functionality-graceful-handling.md`
- [x] `U` `apps/f1/test-drives/006-label-based-selection-verification.md`
- [x] `U` `apps/f1/test-drives/2025-12-04-comprehensive-test-drive.md`
- [x] `D` `apps/f1/test-drives/2026-01-13-multi-repo-orchestration.md`
- [x] `U` `apps/f1/test-drives/2026-02-12-cursor-harness-validation.md`
- [x] `U` `apps/f1/test-drives/2026-02-13-cursor-harness-validation.md`
- [x] `U` `apps/f1/test-drives/2026-02-13-cursor-non-mock-f1-drive.md`
- [x] `U` `apps/f1/test-drives/2026-02-13-cursor-resume-continuation-validation.md`
- [x] `U` `apps/f1/test-drives/2026-02-13-cursor-stop-tool-logging-validation.md`
- [x] `U` `apps/f1/test-drives/2026-02-14-cursor-mcp-permissions-mapping-validation.md`
- [x] `U` `apps/f1/test-drives/2026-02-14-cursor-permissions-mapping-validation.md`
- [x] `U` `apps/f1/test-drives/2026-02-18-cypack-817-fastify-mcp-validation.md`
- [x] `U` `apps/f1/test-drives/README.md`
- [x] `U` `apps/f1/tsconfig.json`
- [x] `U` `apps/f1/vitest.config.ts`

### Checklist: `code` (1 files)
- [x] `U` `code/test.js`

### Checklist: `docs` (5 files)
- [x] `U` `docs/CLOUDFLARE_TUNNEL.md`
- [x] `U` `docs/CONFIG_FILE.md`
- [x] `U` `docs/GIT_GITHUB.md`
- [x] `U` `docs/SELF_HOSTING.md`
- [x] `U` `docs/SETUP_SCRIPTS.md`

### Checklist: `packages/CLAUDE.md` (1 files)
- [x] `D` `packages/CLAUDE.md`

### Checklist: `packages/README.md` (1 files)
- [x] `I` `packages/README.md`

### Checklist: `packages/claude-runner` (29 files)
- [x] `U` `packages/claude-runner/.gitignore`
- [x] `U` `packages/claude-runner/package.json`
- [x] `U` `packages/claude-runner/src/ClaudeRunner.ts`
- [x] `U` `packages/claude-runner/src/config.ts`
- [x] `U` `packages/claude-runner/src/formatter.ts`
- [x] `U` `packages/claude-runner/src/index.ts`
- [x] `U` `packages/claude-runner/src/types.ts`
- [x] `U` `packages/claude-runner/test/ClaudeRunner.test.ts`
- [x] `U` `packages/claude-runner/test/config.test.ts`
- [x] `U` `packages/claude-runner/test/disallowed-tools.test.ts`
- [x] `U` `packages/claude-runner/test/tools/cyrus-tools/fs-extra-import.test.ts`
- [x] `U` `packages/claude-runner/test-scripts/README.md`
- [x] `U` `packages/claude-runner/test-scripts/debug-streaming.js`
- [x] `U` `packages/claude-runner/test-scripts/edgeworker-like-test.js`
- [x] `U` `packages/claude-runner/test-scripts/mcp-isolation-test.js`
- [x] `U` `packages/claude-runner/test-scripts/minimal-async-test.js`
- [x] `U` `packages/claude-runner/test-scripts/production-like-test.js`
- [x] `U` `packages/claude-runner/test-scripts/quick-test.js`
- [x] `U` `packages/claude-runner/test-scripts/simple-claude-runner-test.js`
- [x] `U` `packages/claude-runner/test-scripts/streaming-test.js`
- [x] `U` `packages/claude-runner/test-scripts/subagent-functionality-test.js`
- [x] `U` `packages/claude-runner/test-scripts/test-continue-flag.js`
- [x] `U` `packages/claude-runner/test-scripts/test-direct-sdk.js`
- [x] `U` `packages/claude-runner/test-scripts/test-get-child-issues.js`
- [x] `U` `packages/claude-runner/test-scripts/test-mcp-config.js`
- [x] `U` `packages/claude-runner/test-scripts/test-readable-logging.js`
- [x] `U` `packages/claude-runner/test-scripts/workdir-test.js`
- [x] `U` `packages/claude-runner/tsconfig.json`
- [x] `U` `packages/claude-runner/vitest.config.ts`

### Checklist: `packages/cloudflare-tunnel-client` (9 files)
- [x] `U` `packages/cloudflare-tunnel-client/.gitignore`
- [x] `U` `packages/cloudflare-tunnel-client/README.md`
- [x] `U` `packages/cloudflare-tunnel-client/package.json`
- [x] `U` `packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts`
- [x] `U` `packages/cloudflare-tunnel-client/src/ConfigApiClient.ts`
- [x] `U` `packages/cloudflare-tunnel-client/src/index.ts`
- [x] `U` `packages/cloudflare-tunnel-client/src/types.ts`
- [x] `U` `packages/cloudflare-tunnel-client/tsconfig.json`
- [x] `U` `packages/cloudflare-tunnel-client/vitest.config.ts`

### Checklist: `packages/codex-runner` (12 files)
- [x] `U` `packages/codex-runner/package.json`
- [x] `U` `packages/codex-runner/src/CodexRunner.ts`
- [x] `U` `packages/codex-runner/src/SimpleCodexRunner.ts`
- [x] `U` `packages/codex-runner/src/formatter.ts`
- [x] `U` `packages/codex-runner/src/index.ts`
- [x] `U` `packages/codex-runner/src/types.ts`
- [x] `U` `packages/codex-runner/test/CodexRunner.mcp-config.test.ts`
- [x] `U` `packages/codex-runner/test/CodexRunner.tool-events.test.ts`
- [x] `U` `packages/codex-runner/test/fixtures/codex-exec-sample.jsonl`
- [x] `U` `packages/codex-runner/test/formatter.replay.test.ts`
- [x] `U` `packages/codex-runner/test/formatter.test.ts`
- [x] `U` `packages/codex-runner/tsconfig.json`

### Checklist: `packages/config-updater` (14 files)
- [x] `U` `packages/config-updater/package.json`
- [x] `U` `packages/config-updater/src/ConfigUpdater.ts`
- [x] `U` `packages/config-updater/src/handlers/checkGh.ts`
- [x] `U` `packages/config-updater/src/handlers/configureMcp.ts`
- [x] `U` `packages/config-updater/src/handlers/cyrusConfig.ts`
- [x] `U` `packages/config-updater/src/handlers/cyrusEnv.ts`
- [x] `U` `packages/config-updater/src/handlers/repository.ts`
- [x] `U` `packages/config-updater/src/handlers/testMcp.ts`
- [x] `U` `packages/config-updater/src/index.ts`
- [x] `U` `packages/config-updater/src/types.ts`
- [x] `U` `packages/config-updater/test/handlers/checkGh.test.ts`
- [x] `U` `packages/config-updater/test-scripts/test-check-gh.js`
- [x] `U` `packages/config-updater/tsconfig.json`
- [x] `U` `packages/config-updater/vitest.config.ts`

### Checklist: `packages/core` (36 files)
- [x] `U` `packages/core/.gitignore`
- [x] `U` `packages/core/package.json`
- [x] `D` `packages/core/src/CyrusAgentSession.ts`
- [x] `D` `packages/core/src/PersistenceManager.ts`
- [x] `U` `packages/core/src/StreamingPrompt.ts`
- [x] `U` `packages/core/src/agent-runner-types.ts`
- [x] `I` `packages/core/src/config-schemas.ts`
- [x] `I` `packages/core/src/config-types.ts`
- [x] `U` `packages/core/src/constants.ts`
- [x] `U` `packages/core/src/index.ts`
- [x] `U` `packages/core/src/issue-tracker/AgentEvent.ts`
- [x] `U` `packages/core/src/issue-tracker/IAgentEventTransport.ts`
- [x] `U` `packages/core/src/issue-tracker/IIssueTrackerService.ts`
- [x] `U` `packages/core/src/issue-tracker/adapters/CLIEventTransport.ts`
- [x] `U` `packages/core/src/issue-tracker/adapters/CLIIssueTrackerService.ts`
- [x] `U` `packages/core/src/issue-tracker/adapters/CLIRPCServer.ts`
- [x] `U` `packages/core/src/issue-tracker/adapters/CLITypes.ts`
- [x] `U` `packages/core/src/issue-tracker/adapters/index.ts`
- [x] `U` `packages/core/src/issue-tracker/index.ts`
- [x] `U` `packages/core/src/issue-tracker/types.ts`
- [x] `U` `packages/core/src/logging/ILogger.ts`
- [x] `U` `packages/core/src/logging/Logger.ts`
- [x] `U` `packages/core/src/logging/index.ts`
- [x] `U` `packages/core/src/messages/IMessageTranslator.ts`
- [x] `U` `packages/core/src/messages/index.ts`
- [x] `U` `packages/core/src/messages/platform-refs.ts`
- [x] `U` `packages/core/src/messages/type-guards.ts`
- [x] `U` `packages/core/src/messages/types.ts`
- [x] `U` `packages/core/src/simple-agent-runner-types.ts`
- [x] `U` `packages/core/test/CLIIssueTrackerService.labels.test.ts`
- [x] `U` `packages/core/test/CLIRPCServer.ephemeral.test.ts`
- [x] `U` `packages/core/test/CLITypes.test.ts`
- [x] `D` `packages/core/test/PersistenceManager.migration.test.ts`
- [x] `U` `packages/core/test/logging/Logger.test.ts`
- [x] `U` `packages/core/tsconfig.json`
- [x] `U` `packages/core/vitest.config.ts`

### Checklist: `packages/cursor-runner` (13 files)
- [x] `U` `packages/cursor-runner/package.json`
- [x] `U` `packages/cursor-runner/src/CursorRunner.ts`
- [x] `U` `packages/cursor-runner/src/SimpleCursorRunner.ts`
- [x] `U` `packages/cursor-runner/src/formatter.ts`
- [x] `U` `packages/cursor-runner/src/index.ts`
- [x] `U` `packages/cursor-runner/src/types.ts`
- [x] `U` `packages/cursor-runner/test/CursorRunner.mcp-enable.test.ts`
- [x] `U` `packages/cursor-runner/test/CursorRunner.permissions.test.ts`
- [x] `U` `packages/cursor-runner/test/CursorRunner.tool-events.test.ts`
- [x] `U` `packages/cursor-runner/test/fixtures/cursor-exec-sample.jsonl`
- [x] `U` `packages/cursor-runner/test/formatter.replay.test.ts`
- [x] `U` `packages/cursor-runner/test/formatter.test.ts`
- [x] `U` `packages/cursor-runner/tsconfig.json`

### Checklist: `packages/edge-worker` (114 files)
- [x] `U` `packages/edge-worker/.gitignore`
- [x] `I` `packages/edge-worker/README.md`
- [x] `U` `packages/edge-worker/examples/cli-integration.ts`
- [x] `U` `packages/edge-worker/examples/custom-prompt.md`
- [x] `U` `packages/edge-worker/examples/electron-integration.ts`
- [x] `U` `packages/edge-worker/label-prompt-template.md`
- [x] `U` `packages/edge-worker/package.json`
- [x] `U` `packages/edge-worker/prompt-template.md`
- [x] `U` `packages/edge-worker/prompts/builder.md`
- [x] `U` `packages/edge-worker/prompts/debugger.md`
- [x] `U` `packages/edge-worker/prompts/graphite-orchestrator.md`
- [x] `D` `packages/edge-worker/prompts/orchestrator.md`
- [x] `U` `packages/edge-worker/prompts/scoper.md`
- [x] `U` `packages/edge-worker/prompts/standard-issue-assigned-user-prompt.md`
- [x] `U` `packages/edge-worker/prompts/todolist-system-prompt-extension.md`
- [x] `I` `packages/edge-worker/src/ActivityPoster.ts`
- [x] `I` `packages/edge-worker/src/AgentSessionManager.ts`
- [x] `U` `packages/edge-worker/src/AskUserQuestionHandler.ts`
- [x] `U` `packages/edge-worker/src/AttachmentService.ts`
- [x] `I` `packages/edge-worker/src/ChatSessionHandler.ts`
- [x] `U` `packages/edge-worker/src/ConfigManager.ts`
- [x] `D` `packages/edge-worker/src/EdgeWorker.ts`
- [x] `U` `packages/edge-worker/src/GitService.ts`
- [x] `I` `packages/edge-worker/src/GlobalSessionRegistry.ts`
- [x] `D` `packages/edge-worker/src/PromptBuilder.ts`
- [x] `D` `packages/edge-worker/src/RepositoryRouter.ts`
- [x] `U` `packages/edge-worker/src/RunnerSelectionService.ts`
- [x] `U` `packages/edge-worker/src/SharedApplicationServer.ts`
- [x] `U` `packages/edge-worker/src/SharedWebhookServer.ts`
- [x] `U` `packages/edge-worker/src/SlackChatAdapter.ts`
- [x] `U` `packages/edge-worker/src/UserAccessControl.ts`
- [x] `U` `packages/edge-worker/src/WorktreeIncludeService.ts`
- [x] `U` `packages/edge-worker/src/index.ts`
- [x] `U` `packages/edge-worker/src/procedures/ProcedureAnalyzer.ts`
- [x] `U` `packages/edge-worker/src/procedures/index.ts`
- [x] `U` `packages/edge-worker/src/procedures/registry.ts`
- [x] `U` `packages/edge-worker/src/procedures/types.ts`
- [x] `U` `packages/edge-worker/src/prompt-assembly/types.ts`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/changelog-update.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/coding-activity.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/concise-summary.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/debugger-fix.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/debugger-reproduction.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/get-approval.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/gh-pr.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/git-commit.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/plan-summary.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/preparation.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/question-answer.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/question-investigation.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/release-execution.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/release-summary.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/user-testing-summary.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/user-testing.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/validation-fixer.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/verbose-summary.md`
- [x] `U` `packages/edge-worker/src/prompts/subroutines/verifications.md`
- [x] `U` `packages/edge-worker/src/sinks/IActivitySink.ts`
- [x] `U` `packages/edge-worker/src/sinks/LinearActivitySink.ts`
- [x] `U` `packages/edge-worker/src/sinks/NoopActivitySink.ts`
- [x] `U` `packages/edge-worker/src/sinks/index.ts`
- [x] `I` `packages/edge-worker/src/types.ts`
- [x] `U` `packages/edge-worker/src/validation/ValidationLoopController.ts`
- [x] `U` `packages/edge-worker/src/validation/index.ts`
- [x] `U` `packages/edge-worker/src/validation/types.ts`
- [x] `U` `packages/edge-worker/test/AgentSessionManager.codex-runner-activity.test.ts`
- [x] `U` `packages/edge-worker/test/AgentSessionManager.github-session.test.ts`
- [x] `U` `packages/edge-worker/test/AgentSessionManager.model-notification.test.ts`
- [x] `U` `packages/edge-worker/test/AgentSessionManager.status-message.test.ts`
- [x] `U` `packages/edge-worker/test/AgentSessionManager.stop-session.test.ts`
- [x] `U` `packages/edge-worker/test/AgentSessionManager.tool-formatting.test.ts`
- [x] `U` `packages/edge-worker/test/AskUserQuestionHandler.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.attachments.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.dynamic-tools.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.feedback-delivery.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.feedback-timeout.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.fetchPRBranchRef.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.label-based-prompt-command.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.linear-client-wrapper.test.ts`
- [x] `D` `packages/edge-worker/test/EdgeWorker.missing-session-recovery.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.orchestrator-label-rerouting.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.parent-branch.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.procedure-integration.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.procedure-routing.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.runner-selection.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.screenshot-upload-hooks.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.status-endpoint.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.subroutine-disallowed-tools.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.system-prompt-resume.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.version-endpoint.test.ts`
- [x] `U` `packages/edge-worker/test/EdgeWorker.versioning.test.ts`
- [x] `U` `packages/edge-worker/test/GitService.test.ts`
- [x] `U` `packages/edge-worker/test/GlobalSessionRegistry.test.ts`
- [x] `U` `packages/edge-worker/test/LinearActivitySink.test.ts`
- [x] `D` `packages/edge-worker/test/RepositoryRouter.test.ts`
- [x] `U` `packages/edge-worker/test/UserAccessControl.test.ts`
- [x] `U` `packages/edge-worker/test/WorktreeIncludeService.test.ts`
- [x] `U` `packages/edge-worker/test/chat-sessions.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly-utils.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.component-order.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.continuation-sessions.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.metadata-tracking.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.new-comment-metadata.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.new-sessions.test.ts`
- [x] `D` `packages/edge-worker/test/prompt-assembly.routing-context.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.streaming-sessions.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.subroutines.test.ts`
- [x] `U` `packages/edge-worker/test/prompt-assembly.system-prompt-behavior.test.ts`
- [x] `U` `packages/edge-worker/test/setup.ts`
- [x] `U` `packages/edge-worker/test/validation-loop.test.ts`
- [x] `U` `packages/edge-worker/test/version-extraction.test.ts`
- [x] `U` `packages/edge-worker/test-scripts/simple-runner-all-harnesses-test.js`
- [x] `U` `packages/edge-worker/tsconfig.json`
- [x] `U` `packages/edge-worker/vitest.config.ts`

### Checklist: `packages/gemini-runner` (24 files)
- [x] `U` `packages/gemini-runner/CLAUDE.md`
- [x] `U` `packages/gemini-runner/README.md`
- [x] `U` `packages/gemini-runner/examples/basic-usage.ts`
- [x] `U` `packages/gemini-runner/examples/simple-agent-example.ts`
- [x] `U` `packages/gemini-runner/package.json`
- [x] `U` `packages/gemini-runner/src/GeminiRunner.ts`
- [x] `U` `packages/gemini-runner/src/SimpleGeminiRunner.ts`
- [x] `U` `packages/gemini-runner/src/adapters.ts`
- [x] `U` `packages/gemini-runner/src/formatter.ts`
- [x] `U` `packages/gemini-runner/src/index.ts`
- [x] `U` `packages/gemini-runner/src/prompts/system.md`
- [x] `U` `packages/gemini-runner/src/schemas.ts`
- [x] `U` `packages/gemini-runner/src/settingsGenerator.ts`
- [x] `U` `packages/gemini-runner/src/systemPromptManager.ts`
- [x] `U` `packages/gemini-runner/src/types.ts`
- [x] `U` `packages/gemini-runner/test/GeminiRunner.test.ts`
- [x] `U` `packages/gemini-runner/test/SimpleGeminiRunner.test.ts`
- [x] `U` `packages/gemini-runner/test/formatter.test.ts`
- [x] `U` `packages/gemini-runner/test/schemas.test.ts`
- [x] `U` `packages/gemini-runner/test-scripts/simple-gemini-runner-test.js`
- [x] `U` `packages/gemini-runner/test-scripts/test-gemini-runner.ts`
- [x] `U` `packages/gemini-runner/test-scripts/test-settings-backup.js`
- [x] `U` `packages/gemini-runner/test-scripts/test-settings-backup.ts`
- [x] `U` `packages/gemini-runner/tsconfig.json`

### Checklist: `packages/github-event-transport` (14 files)
- [x] `U` `packages/github-event-transport/package.json`
- [x] `U` `packages/github-event-transport/src/GitHubCommentService.ts`
- [x] `U` `packages/github-event-transport/src/GitHubEventTransport.ts`
- [x] `U` `packages/github-event-transport/src/GitHubMessageTranslator.ts`
- [x] `U` `packages/github-event-transport/src/github-webhook-utils.ts`
- [x] `U` `packages/github-event-transport/src/index.ts`
- [x] `U` `packages/github-event-transport/src/types.ts`
- [x] `U` `packages/github-event-transport/test/GitHubCommentService.test.ts`
- [x] `U` `packages/github-event-transport/test/GitHubEventTransport.test.ts`
- [x] `U` `packages/github-event-transport/test/GitHubMessageTranslator.test.ts`
- [x] `U` `packages/github-event-transport/test/fixtures.ts`
- [x] `U` `packages/github-event-transport/test/github-webhook-utils.test.ts`
- [x] `U` `packages/github-event-transport/tsconfig.json`
- [x] `U` `packages/github-event-transport/vitest.config.ts`

### Checklist: `packages/linear-event-transport` (9 files)
- [x] `U` `packages/linear-event-transport/package.json`
- [x] `U` `packages/linear-event-transport/src/LinearEventTransport.ts`
- [x] `U` `packages/linear-event-transport/src/LinearIssueTrackerService.ts`
- [x] `U` `packages/linear-event-transport/src/LinearMessageTranslator.ts`
- [x] `U` `packages/linear-event-transport/src/index.ts`
- [x] `U` `packages/linear-event-transport/src/types.ts`
- [x] `U` `packages/linear-event-transport/test/LinearMessageTranslator.test.ts`
- [x] `U` `packages/linear-event-transport/tsconfig.json`
- [x] `U` `packages/linear-event-transport/vitest.config.ts`

### Checklist: `packages/mcp-tools` (8 files)
- [x] `U` `packages/mcp-tools/package.json`
- [x] `U` `packages/mcp-tools/src/index.ts`
- [x] `U` `packages/mcp-tools/src/tools/cyrus-tools/index.ts`
- [x] `U` `packages/mcp-tools/src/tools/image-tools/index.ts`
- [x] `U` `packages/mcp-tools/src/tools/sora-tools/index.ts`
- [x] `U` `packages/mcp-tools/test/tools/cyrus-tools/get-child-issues-integration.test.ts`
- [x] `U` `packages/mcp-tools/test/tools/cyrus-tools/zod-version-compatibility.test.ts`
- [x] `U` `packages/mcp-tools/tsconfig.json`

### Checklist: `packages/simple-agent-runner` (12 files)
- [x] `U` `packages/simple-agent-runner/.gitignore`
- [x] `U` `packages/simple-agent-runner/README.md`
- [x] `U` `packages/simple-agent-runner/examples/basic-usage.ts`
- [x] `U` `packages/simple-agent-runner/package.json`
- [x] `U` `packages/simple-agent-runner/src/SimpleAgentRunner.ts`
- [x] `U` `packages/simple-agent-runner/src/SimpleClaudeRunner.ts`
- [x] `U` `packages/simple-agent-runner/src/errors.ts`
- [x] `U` `packages/simple-agent-runner/src/index.ts`
- [x] `U` `packages/simple-agent-runner/src/types.ts`
- [x] `U` `packages/simple-agent-runner/test/SimpleAgentRunner.test.ts`
- [x] `U` `packages/simple-agent-runner/test/errors.test.ts`
- [x] `U` `packages/simple-agent-runner/tsconfig.json`

### Checklist: `packages/slack-event-transport` (12 files)
- [x] `U` `packages/slack-event-transport/package.json`
- [x] `U` `packages/slack-event-transport/src/SlackEventTransport.ts`
- [x] `U` `packages/slack-event-transport/src/SlackMessageService.ts`
- [x] `U` `packages/slack-event-transport/src/SlackMessageTranslator.ts`
- [x] `U` `packages/slack-event-transport/src/SlackReactionService.ts`
- [x] `U` `packages/slack-event-transport/src/index.ts`
- [x] `U` `packages/slack-event-transport/src/types.ts`
- [x] `U` `packages/slack-event-transport/test/SlackEventTransport.test.ts`
- [x] `U` `packages/slack-event-transport/test/SlackMessageService.test.ts`
- [x] `U` `packages/slack-event-transport/test/SlackMessageTranslator.test.ts`
- [x] `U` `packages/slack-event-transport/test/fixtures.ts`
- [x] `U` `packages/slack-event-transport/tsconfig.json`

### Checklist: `scripts` (1 files)
- [x] `U` `scripts/symlink-skills.sh`

### Checklist: `skills` (1 files)
- [x] `U` `skills/f1-test-drive/SKILL.md`

### Checklist: `spec` (1 files)
- [x] `U` `spec/f1/ARCHITECTURE.md`
