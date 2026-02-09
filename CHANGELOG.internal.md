# Internal Changelog

This changelog documents internal development changes, refactors, tooling updates, and other non-user-facing modifications.

## [Unreleased]

### Changed
- Improved Task tool formatting: TaskCreate now bolds subjects for list-like appearance, TaskUpdate/TaskGet show cached task subjects instead of bare IDs. Added `taskSubjectsByTaskId` cache in AgentSessionManager that captures subjects from TaskCreate results and enriches subsequent TaskUpdate/TaskGet tool inputs. Updated both ClaudeMessageFormatter and GeminiMessageFormatter. ([CYPACK-794](https://linear.app/ceedar/issue/CYPACK-794), [#845](https://github.com/ceedaragents/cyrus/pull/845))
- Refactored formatting strategy from TodoWrite to Task tools (TaskCreate, TaskUpdate, TaskList, TaskGet). Added `formatTaskParameter()` method to IMessageFormatter interface and updated AgentSessionManager to handle Task tools as thought activities. ([CYPACK-788](https://linear.app/ceedar/issue/CYPACK-788), [#837](https://github.com/ceedaragents/cyrus/pull/837))

### Added
- Subroutine result text is now stored in procedure history when advancing between subroutines. On error results (e.g. `error_max_turns` from single-turn subroutines), `AgentSessionManager` recovers by using the last completed subroutine's result via `ProcedureAnalyzer.getLastSubroutineResult()`, allowing the procedure to continue to completion instead of failing. Added `disallowAllTools` parameter to `buildAgentRunnerConfig` and `tools` config pass-through to `ClaudeRunner` for properly disabling built-in tools. ([CYPACK-792](https://linear.app/ceedar/issue/CYPACK-792), [#843](https://github.com/ceedaragents/cyrus/pull/843))

## [0.2.20] - 2026-02-05

(No internal changes in this release)

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
