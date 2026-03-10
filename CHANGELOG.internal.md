# Internal Changelog

This changelog documents internal development changes, refactors, tooling updates, and other non-user-facing modifications.

## [Unreleased]

## [0.2.33] - 2026-03-10

### Fixed
- ClaudeRunner now infers `type: "http"` for file-loaded MCP server configs that have a `url` but no `type` discriminator. The Claude Agent SDK requires an explicit `type` field — without it, sessions crash with 0 messages. Codex/Gemini runners are unaffected because they do property-based translation. ([#966](https://github.com/ceedaragents/cyrus/pull/966))

### Changed
- Replaced placeholder `testMcp` handler with actual MCP SDK integration: stdio spawns via `StdioClientTransport`, HTTP/SSE connects via `StreamableHTTPClientTransport`, both perform `tools/list` and return discovered tools. Added `@modelcontextprotocol/sdk` dependency to config-updater and `NodeNext` module resolution. ([#966](https://github.com/ceedaragents/cyrus/pull/966))
- Refactored MCP test handler: fixed `withTimeout` timer leak by clearing setTimeout on settlement, extracted `connectAndDiscover()` to eliminate duplicated connect/list/respond logic, avoided mutating `payload.commandArgs` by copying before sort, added 5s timeout to `client.close()` to prevent zombie stdio processes. ([#966](https://github.com/ceedaragents/cyrus/pull/966))
- MCP config files moved to `~/.cyrus/mcp-configs/` subdirectory; config-updater routes consolidated under `/api/update/` prefix. ([#966](https://github.com/ceedaragents/cyrus/pull/966))
- Restored tab indentation in all package.json files.

## [0.2.32] - 2026-03-10

### Changed
- **Consolidated parent-child session mapping to single source of truth** - Removed redundant `EdgeWorker.childToParentAgentSession` map. `GlobalSessionRegistry` is now the sole owner of parent-child session mappings, eliminating the dual-write obligation that caused the orchestrator result-writing regression. Serialization format (`childToParentAgentSession` key) preserved for backward compatibility. ([CYPACK-922](https://linear.app/ceedar/issue/CYPACK-922), [#957](https://github.com/ceedaragents/cyrus/pull/957))
- Moved `linearToken`, `linearRefreshToken`, and `linearWorkspaceSlug` from per-repository/global config into the `linearWorkspaces` map keyed by Linear workspace ID. `EdgeWorker.issueTrackers` now creates one `IIssueTrackerService` per workspace instead of per repository, eliminating redundant Linear clients. Removed `getIssueTrackerForRepository` wrappers from `EdgeWorker` and `ActivityPoster` — callers now use workspace ID directly. `AttachmentService` accepts workspace ID and resolves tokens internally. Includes idempotent config migration, workspace-level OAuth refresh, and updated CLI commands. ([CYPACK-912](https://linear.app/ceedar/issue/CYPACK-912), [#959](https://github.com/ceedaragents/cyrus/pull/959))
- Updated `buildAllowedTools()` to compute union across `RepositoryConfig[]` (presets resolved per-repo, then unioned) and `buildDisallowedTools()` to compute intersection (only block if ALL repos block). `buildMcpConfig()` now accepts `RepositoryConfig[]` with workspace-level MCP servers (Linear, cyrus-tools, Slack) configured once per session. Added `buildMergedMcpConfigPath()` to concatenate per-repo `.mcp.json` paths. ([CYPACK-918](https://linear.app/ceedar/issue/CYPACK-918), [#963](https://github.com/ceedaragents/cyrus/pull/963))
- Updated `issueRepositoryCache` from `Map<issueId, string>` to `Map<issueId, string[]>` for multi-repo session support. Routing now returns `RepositoryConfig[]` instead of a single repository. Description tag parsing supports multiple `[repo=...]` tags, label-based routing returns all matching repos, and no-match cases return `needs_selection` instead of a default fallback. Includes cache serialization migration from `Record<string, string>` to `Record<string, string[]>`. ([CYPACK-915](https://linear.app/ceedar/issue/CYPACK-915), [#961](https://github.com/ceedaragents/cyrus/pull/961))

### Added
- `GitService.createGitWorktree()` now accepts `RepositoryConfig[]` and creates the correct folder layout for 0, 1, or N repositories. Added Graphite blocked-by base branch resolution (`determineBaseBranch`, `hasGraphiteLabel`, `fetchBlockingIssues`) directly into `GitService` so worktrees start from the correct base branch without agents needing to rebase. Extended `Workspace` type with `repoPaths` for multi-repo path mapping. ([CYPACK-917](https://linear.app/ceedar/issue/CYPACK-917), [#962](https://github.com/ceedaragents/cyrus/pull/962))
- Added `RepositoryContext` type and `repositories: RepositoryContext[]` field to `CyrusAgentSession`. Each session now explicitly carries its repository context (repositoryId, branchName, baseBranchName). Old sessions without `repositories` default to `[]` on deserialization. ([CYPACK-914](https://linear.app/ceedar/issue/CYPACK-914), [#960](https://github.com/ceedaragents/cyrus/pull/960))
- Consolidated `AgentSessionManager` from a per-repository `Map<string, AgentSessionManager>` to a single instance in `EdgeWorker`. Activity sink resolution moved from constructor-level to per-session via `setActivitySink()`. Serialization format flattened from nested `{[repoId]: {[sessionId]: session}}` to `{[sessionId]: session}` with persistence version bumped 3.0 → 4.0 (backward-compatible migration). ([CYPACK-911](https://linear.app/ceedar/issue/CYPACK-911), [#955](https://github.com/ceedaragents/cyrus/pull/955))
