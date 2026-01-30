# Internal Changelog

This changelog documents internal development changes, refactors, tooling updates, and other non-user-facing modifications.

## [Unreleased]

### Changed
- Refactored logging across all packages to use a dedicated `ILogger` interface and `Logger` implementation in `packages/core/src/logging/`. Replaced direct `console.log`/`console.error` calls in EdgeWorker, AgentSessionManager, ClaudeRunner, GitService, RepositoryRouter, SharedApplicationServer, SharedWebhookServer, WorktreeIncludeService, ProcedureAnalyzer, AskUserQuestionHandler, LinearEventTransport, and LinearIssueTrackerService with structured logger calls. Log level is configurable via the `CYRUS_LOG_LEVEL` environment variable (DEBUG, INFO, WARN, ERROR, SILENT).
- Added source context (session ID, platform, issue identifier, repository) to log messages via `logger.withContext()`, enabling easier debugging and log filtering across concurrent sessions
- Updated `CyrusAgentSession` schema to v3.0: renamed `linearAgentActivitySessionId` to `id`, added optional `externalSessionId` for tracker-specific IDs, added optional `issueContext` object for issue metadata, made `issue` and `issueId` optional to support standalone sessions ([CYPACK-728](https://linear.app/ceedar/issue/CYPACK-728), [#770](https://github.com/ceedaragents/cyrus/pull/770))
- Updated `PersistenceManager` to v3.0 format with automatic migration from v2.0, preserving all existing session data during migration ([CYPACK-728](https://linear.app/ceedar/issue/CYPACK-728), [#770](https://github.com/ceedaragents/cyrus/pull/770))

### Fixed
- Fixed `GitService.createGitWorktree()` to check `git worktree list --porcelain` before attempting `git worktree add` with an existing branch, detecting and reusing worktrees where the branch is already checked out ([CYPACK-775](https://linear.app/ceedar/issue/CYPACK-775), [#823](https://github.com/ceedaragents/cyrus/pull/823))

### Added
- New `cyrus-github-event-transport` package: EventEmitter-based transport for receiving and verifying forwarded GitHub webhooks, with proxy (Bearer token) and signature (HMAC-SHA256) verification modes, a `GitHubCommentService` for posting replies via GitHub REST API, and utility functions for extracting webhook payload data. ([CYPACK-772](https://linear.app/ceedar/issue/CYPACK-772), [#820](https://github.com/ceedaragents/cyrus/pull/820))
- EdgeWorker GitHub webhook integration: `/github-webhook` endpoint, session creation flow for PR comments, git worktree checkout for PR branches, and reply posting via GitHub API. ([CYPACK-772](https://linear.app/ceedar/issue/CYPACK-772), [#820](https://github.com/ceedaragents/cyrus/pull/820))
- Subroutine result text is now stored in procedure history when advancing between subroutines. On error results (e.g. `error_max_turns` from single-turn subroutines), `AgentSessionManager` recovers by using the last completed subroutine's result via `ProcedureAnalyzer.getLastSubroutineResult()`, allowing the procedure to continue to completion instead of failing
- Created `GlobalSessionRegistry` class for centralized session storage across all repositories, enabling cross-repository session lookups in orchestrator workflows ([CYPACK-725](https://linear.app/ceedar/issue/CYPACK-725), [#766](https://github.com/ceedaragents/cyrus/pull/766))
- Extracted `IActivitySink` interface and `LinearActivitySink` implementation to decouple activity posting from `IIssueTrackerService`, enabling multiple activity sinks to receive session activities ([CYPACK-726](https://linear.app/ceedar/issue/CYPACK-726), [#767](https://github.com/ceedaragents/cyrus/pull/767))
- Integrated `GlobalSessionRegistry` with `EdgeWorker`, making it the single source of truth for parent-child session mappings and cross-repository session lookups ([CYPACK-727](https://linear.app/ceedar/issue/CYPACK-727), [#769](https://github.com/ceedaragents/cyrus/pull/769))

## [0.2.19] - 2026-01-24

### Fixed
- Fixed labelPrompts schema to accept both simple array form (`{ debugger: ["Bug"] }`) and complex object form (`{ debugger: { labels: ["Bug"], allowedTools?: ... } }`). This resolves type mismatches when cyrus-hosted sends simplified configurations. ([#802](https://github.com/ceedaragents/cyrus/pull/802))

## [0.2.18] - 2026-01-23

### Changed
- Replaced manual TypeScript interfaces with Zod schemas as the source of truth for `EdgeConfig`, `RepositoryConfig`, and related configuration types. This ensures type safety at both compile-time and runtime, and fixes type drift where `CyrusConfigPayload` was missing fields like `issueUpdateTrigger`. ([#800](https://github.com/ceedaragents/cyrus/pull/800))

## [0.2.17] - 2026-01-23

(No internal changes in this release)

## [0.2.16] - 2026-01-23

(No internal changes in this release)

## [0.2.15] - 2026-01-16

(No internal changes in this release)

## [0.2.14] - 2026-01-16

(No internal changes in this release)

## [0.2.13] - 2026-01-15

(No internal changes in this release)

## [0.2.12] - 2026-01-09

(No internal changes in this release)

## [0.2.11] - 2026-01-07

(No internal changes in this release)

## [0.2.10] - 2026-01-06

(No internal changes in this release)

## [0.2.9] - 2025-12-30

(No internal changes in this release)

## [0.2.8] - 2025-12-28

(No internal changes in this release)

## [0.2.7] - 2025-12-28

### Changed
- Moved publishing docs from CLAUDE.md to `/release` skill for cleaner documentation and easier invocation ([CYPACK-667](https://linear.app/ceedar/issue/CYPACK-667), [#705](https://github.com/ceedaragents/cyrus/pull/705))

## [0.2.6] - 2025-12-22

### Fixed
- Fixed the CLI issue tracker's `labels()` method to return actual label data instead of an empty array, enabling correct runner selection (Codex/Gemini) in F1 tests ([CYPACK-547](https://linear.app/ceedar/issue/CYPACK-547), [#624](https://github.com/ceedaragents/cyrus/pull/624))
