# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Three-phase execution system**: Cyrus now runs in three distinct phases for better reliability:
  - **Primary phase**: Completes the main work on the issue
  - **Closure phase**: Runs tests, linting, creates/updates PR, and ensures production readiness
  - **Summary phase**: Generates a concise final summary (limited to 1 turn for efficiency)
- **Sora 2 video generation support**: Added custom MCP tools for OpenAI Sora 2 video generation with three tools: `mcp__sora-tools__sora_generate_video` to start video generation (supports text-to-video and image-to-video via `input_reference` parameter; reference images must match target video resolution and be in JPEG, PNG, or WebP format only), `mcp__sora-tools__sora_check_status` to poll job status, and `mcp__sora-tools__sora_get_video` to download completed videos. Configure via `soraApiKey` and `soraOutputDirectory` in repository config.
- **Simple agent runner package**: Added new `cyrus-simple-agent-runner` package for constrained agent queries that return one of a predefined set of responses (e.g., "yes", "no"). Features type-safe enumerated responses, comprehensive error handling, and progress tracking.

### Changed
- **Cleaner Linear activity stream**:
  - Summary phase posts only once (as a 'response') instead of duplicating content
  - Primary and closure phases stream all thoughts and actions normally
  - Model notifications ("Using model: ...") only appear during primary phase
- **Improved PR creation reliability**: PR creation moved to dedicated closure phase with unlimited turns
- **Git workflow optimization**: Git commit and push instructions moved from primary phase prompts to closure phase. This ensures version control operations happen at the right time, after quality checks and before PR creation.
- **Simplified phase tracking**: Removed the confusing `isPhaseTransition` flag. Phase transitions are now determined simply by checking which phase the session is in.
- **Upgraded to official Linear MCP server**: Replaced the unofficial `@tacticlaunch/mcp-linear` stdio-based server with Linear's official HTTP-based MCP server (`https://mcp.linear.app/mcp`). This provides better stability and access to the latest Linear API features.
- Updated @anthropic-ai/claude-agent-sdk from v0.1.5 to v0.1.8 for latest Claude Agent SDK improvements

### Fixed
- **Phase transition race condition**: Fixed "Cannot add message to completed stream" error when transitioning between phases. The `isStreaming()` check now properly validates that the stream is not completed before attempting to add messages.

### Removed
- **Last message marker system**: Removed the `___LAST_MESSAGE_MARKER___` approach in favor of the new three-phase system where summaries are generated in a dedicated phase

## [0.1.54] - 2025-10-04

### Added
- **Automatic MCP config detection**: Cyrus now automatically detects and loads `.mcp.json` files in the repository root. The `.mcp.json` serves as a base configuration that can be extended by explicit `mcpConfigPath` settings, allowing for composable MCP server configurations.

### Fixed
- **Custom instructions now work correctly**: Fixed critical bug where `appendSystemPrompt` was being silently ignored, causing Cyrus to not follow custom instructions or agent guidance. The feature has been fixed to use the correct SDK API (`systemPrompt.append`), making custom prompts and Linear agent guidance work as intended.

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.29

#### cyrus-core
- cyrus-core@0.0.17

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.36

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.22

#### cyrus-ai (CLI)
- cyrus-ai@0.1.54

## [0.1.53] - 2025-10-04

### Added
- **Agent guidance injection**: Cyrus now automatically receives and includes both workspace-level and team-specific agent guidance from Linear in all prompts. When both types of guidance are configured, both are included in the prompt, with team-specific guidance taking precedence as specified by Linear's guidance system.

### Changed
- Updated @linear/sdk from v58.1.0 to v60.0.0 to support agent guidance feature

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.28

#### cyrus-core
- cyrus-core@0.0.16

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.35

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.22

#### cyrus-ai (CLI)
- cyrus-ai@0.1.53
