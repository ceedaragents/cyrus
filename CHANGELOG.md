# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Intelligent procedure routing**: Cyrus now automatically selects the best workflow for each task by analyzing the request content. Simple questions get quick answers, documentation edits proceed directly to implementation, and code changes get the full workflow with verifications and git operations. Uses fast "haiku" model for 10-second classification.
- **Modular subroutine system**: Workflows are composed of reusable subroutines (verifications, git-gh, concise-summary, verbose-summary) that can be mixed and matched based on the procedure selected.
- **Sora 2 video generation support**: Added custom MCP tools for OpenAI Sora 2 video generation with three tools: `mcp__sora-tools__sora_generate_video` to start video generation (supports text-to-video and image-to-video via `input_reference` parameter; reference images must match target video resolution and be in JPEG, PNG, or WebP format only), `mcp__sora-tools__sora_check_status` to poll job status, and `mcp__sora-tools__sora_get_video` to download completed videos. Configure via `soraApiKey` and `soraOutputDirectory` in repository config.
- **Simple agent runner package**: Added new `cyrus-simple-agent-runner` package for constrained agent queries that return one of a predefined set of responses (e.g., "yes", "no"). Features type-safe enumerated responses, comprehensive error handling, and progress tracking.

### Changed
- **Upgraded to official Linear MCP server**: Replaced the unofficial `@tacticlaunch/mcp-linear` stdio-based server with Linear's official HTTP-based MCP server (`https://mcp.linear.app/mcp`). This provides better stability and access to the latest Linear API features.
- Updated @anthropic-ai/claude-agent-sdk from v0.1.5 to v0.1.8 for latest Claude Agent SDK improvements

### Removed
- **Legacy three-phase system**: Removed hardcoded three-phase execution (primary → closure → summary) in favor of intelligent procedure routing. This enables more appropriate workflows based on actual task requirements rather than forcing all tasks through the same three phases.

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
