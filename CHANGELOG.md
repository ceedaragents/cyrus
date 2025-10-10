# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Image generation support**: Added GPT Image tool `mcp__image-tools__gpt_image_generate` for creating images from text prompts using OpenAI's gpt-image-1 model. Features superior instruction following, text rendering, and real-world knowledge. Supports customizable size (1024x1024, 1536x1024, 1024x1536), quality (low/medium/high/auto), background transparency, and output formats (PNG/JPEG/WebP). Images are automatically saved to disk.
- **Sora 2 video generation support**: Added custom MCP tools for OpenAI Sora 2 video generation with three tools: `mcp__sora-tools__sora_generate_video` to start video generation (supports text-to-video and image-to-video via `input_reference` parameter; reference images must match target video resolution and be in JPEG, PNG, or WebP format only), `mcp__sora-tools__sora_check_status` to poll job status, and `mcp__sora-tools__sora_get_video` to download completed videos.

### Changed
- **Breaking: OpenAI configuration naming**: Renamed repository config fields from `soraApiKey`/`soraOutputDirectory` to `openaiApiKey`/`openaiOutputDirectory` to reflect support for multiple OpenAI services (Sora and GPT Image). Update your repository config to use the new field names.

## [0.1.55] - 2025-10-09

### Added
- **Dynamic configuration updates**: Cyrus now automatically detects and applies changes to `~/.cyrus/config.json` without requiring a restart
  - Add or remove repositories on the fly while Cyrus continues running
  - Removed repositories stop all active sessions and post notification messages to Linear
  - Webhook connections automatically reconnect when tokens are updated
  - File watcher uses debouncing to handle rapid configuration changes smoothly

### Changed
- **Upgraded to official Linear MCP server**: Replaced the unofficial `@tacticlaunch/mcp-linear` stdio-based server with Linear's official HTTP-based MCP server (`https://mcp.linear.app/mcp`). This provides better stability and access to the latest Linear API features.
- Updated @anthropic-ai/claude-agent-sdk from v0.1.10 to v0.1.11 - includes parity updates with Claude Code v2.0.11. See [@anthropic-ai/claude-agent-sdk v0.1.11 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#0111---2025-01-09)

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.30

#### cyrus-core
- cyrus-core@0.0.18

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.37

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.23

#### cyrus-ai (CLI)
- cyrus-ai@0.1.55

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
