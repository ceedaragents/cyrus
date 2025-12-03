# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.2.5] - 2025-12-03

### Fixed
- Fixed Zod peer dependency mismatch in claude-runner that caused `mcp__cyrus-tools__linear_agent_session_create` MCP tools to fail with `keyValidator._parse is not a function` error. Downgraded claude-runner's Zod dependency from v4.1.12 to v3.24.1 to match the Claude Agent SDK's peer dependency requirement ([CYPACK-478](https://linear.app/ceedar/issue/CYPACK-478), [#581](https://github.com/ceedaragents/cyrus/pull/581))

### Packages

#### cyrus-cloudflare-tunnel-client
- cyrus-cloudflare-tunnel-client@0.2.5

#### cyrus-config-updater
- cyrus-config-updater@0.2.5

#### cyrus-linear-event-transport
- cyrus-linear-event-transport@0.2.5

#### cyrus-claude-runner
- cyrus-claude-runner@0.2.5

#### cyrus-core
- cyrus-core@0.2.5

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.2.5

#### cyrus-edge-worker
- cyrus-edge-worker@0.2.5

#### cyrus-ai (CLI)
- cyrus-ai@0.2.5

## [0.2.4] - 2025-11-25

### Added
- **Google Gemini AI support** - Cyrus now supports Google's Gemini models alongside Claude. Choose which AI processes your issues by adding labels to Linear issues: use `gemini`, `gemini-2.5-pro`, `gemini-2.5-flash`, or `gemini-3-pro` for Gemini models, or `claude`, `sonnet`, or `opus` for Claude models. If no AI label is present, Cyrus defaults to Claude. This gives you flexibility to select the best AI for each task.

### Fixed
- Fixed race condition in subroutine transitions where new subroutines could start before the previous runner fully cleaned up, which could cause issues with session state management

### Packages

#### cyrus-cloudflare-tunnel-client
- cyrus-cloudflare-tunnel-client@0.2.4

#### cyrus-config-updater
- cyrus-config-updater@0.2.4

#### cyrus-linear-event-transport
- cyrus-linear-event-transport@0.2.4

#### cyrus-claude-runner
- cyrus-claude-runner@0.2.4

#### cyrus-core
- cyrus-core@0.2.4

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.2.4

#### cyrus-edge-worker
- cyrus-edge-worker@0.2.4

#### cyrus-ai (CLI)
- cyrus-ai@0.2.4

## [0.2.3] - 2025-11-24

### Added
- **Claude Opus 4.5 support** - Cyrus now has access to [Claude Opus 4.5](https://www.anthropic.com/claude/opus), Anthropic's most intelligent model with breakthrough capabilities in complex reasoning, advanced coding, and nuanced content creation. Experience significantly improved code generation, deeper analysis, and more sophisticated problem-solving across all Cyrus workflows.

### Changed
- Updated @anthropic-ai/claude-agent-sdk from v0.1.42 to v0.1.52 - includes support for Claude Opus 4.5 and latest agent capabilities. See [@anthropic-ai/claude-agent-sdk v0.1.52 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#0152) ([CYPACK-427](https://linear.app/ceedar/issue/CYPACK-427), [#558](https://github.com/ceedaragents/cyrus/pull/558))
- Updated @anthropic-ai/sdk from v0.69.0 to v0.71.0 - adds Claude Opus 4.5 model support with enhanced performance and capabilities. See [@anthropic-ai/sdk v0.71.0 changelog](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/CHANGELOG.md#0710-2025-11-22) ([CYPACK-427](https://linear.app/ceedar/issue/CYPACK-427), [#558](https://github.com/ceedaragents/cyrus/pull/558))

### Packages

#### cyrus-cloudflare-tunnel-client
- cyrus-cloudflare-tunnel-client@0.2.3

#### cyrus-config-updater
- cyrus-config-updater@0.2.3

#### cyrus-linear-event-transport
- cyrus-linear-event-transport@0.2.3

#### cyrus-claude-runner
- cyrus-claude-runner@0.2.3

#### cyrus-core
- cyrus-core@0.2.3

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.2.3

#### cyrus-edge-worker
- cyrus-edge-worker@0.2.3

#### cyrus-ai (CLI)
- cyrus-ai@0.2.3

## [0.2.2] - 2025-11-19

### Changed
- Improved Linear agent-session tool formatting with custom formatters for better readability: Bash tool descriptions now appear in the action field with round brackets, Edit tool results display as unified diffs, and specialized parameter/result formatters for common tools (Read, Write, Grep, Glob, etc.) extract meaningful information instead of showing raw JSON (CYPACK-395, https://github.com/ceedaragents/cyrus/pull/512)

### Packages

#### cyrus-cloudflare-tunnel-client
- cyrus-cloudflare-tunnel-client@0.2.2

#### cyrus-config-updater
- cyrus-config-updater@0.2.2

#### cyrus-linear-event-transport
- cyrus-linear-event-transport@0.2.2

#### cyrus-claude-runner
- cyrus-claude-runner@0.2.2

#### cyrus-core
- cyrus-core@0.2.2

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.2.2

#### cyrus-edge-worker
- cyrus-edge-worker@0.2.2

#### cyrus-ai (CLI)
- cyrus-ai@0.2.2

## [0.2.1] - 2025-11-15

### Added
- When no routing option matches, it will prompt the user to select which repo they'd like to run Cyrus on for the Linear Issue. Repository selection now displays GitHub repository icons and formatted names when configured with a GitHub URL in the config file. The selected repository will be shown to the user, including what method was used to select it (label-based, team key based, project based, user-selected, etc)
- Restored `--env-file` option to specify custom environment variables file location (uses Commander library for CLI parsing)

### Changed
- Updated @anthropic-ai/claude-agent-sdk from v0.1.31 to v0.1.42 - see [@anthropic-ai/claude-agent-sdk v0.1.42 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#0142)
- Updated @anthropic-ai/sdk from v0.68.0 to v0.69.0 - adds support for structured outputs beta - see [@anthropic-ai/sdk v0.69.0 changelog](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/CHANGELOG.md#0690-2025-11-14)

### Fixed
- Fixed Linear profile URLs in summary subroutines to use correct workspace slug instead of hardcoded "linear" workspace

### Packages

#### cyrus-cloudflare-tunnel-client
- cyrus-cloudflare-tunnel-client@0.2.1

#### cyrus-config-updater
- cyrus-config-updater@0.2.1

#### cyrus-linear-event-transport
- cyrus-linear-event-transport@0.2.1

#### cyrus-claude-runner
- cyrus-claude-runner@0.2.1

#### cyrus-core
- cyrus-core@0.2.1

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.2.1

#### cyrus-edge-worker
- cyrus-edge-worker@0.2.1

#### cyrus-ai (CLI)
- cyrus-ai@0.2.1

## [0.2.0] - 2025-11-07

### Added
- **Cloudflare Tunnel Transport Client**: New `cyrus-cloudflare-tunnel-client` package for receiving configuration updates and webhooks from cyrus-hosted
  - Uses Cloudflare tunnels via `cloudflared` npm package for secure communication
  - Validates customer subscriptions with cyrus-hosted API
  - Handles configuration updates (repositories, environment variables, MCP servers)
  - Receives Linear webhook payloads forwarded through cyrus-hosted
  - Repository management (automatically clones/verifies repositories to `~/.cyrus/repos/<repo-name>`)
  - All file operations restricted to `~/.cyrus` directory for security
  - Will replace `ndjson-client` for customers using cyrus-hosted service
- **Setup Waiting Mode**: After running `cyrus auth`, the client now enters a waiting state to receive configuration from the server
  - Automatically starts server infrastructure (SharedApplicationServer, ConfigUpdater) without repositories
  - Displays clear waiting status and instructions to complete setup
  - Auto-transitions to normal operation when server pushes repository configuration
  - Watches config.json for changes and starts EdgeWorker when repositories are added

### Fixed
- Cyrus client now stays running when all repositories are removed after onboarding, allowing it to receive new configuration from app.atcyrus.com
- Orchestrator label now enforces orchestrator procedure consistently - issues with the Orchestrator label always use the orchestrator-full procedure, even when receiving results from child sub-agents or processing new messages
- Suppressed unnecessary error logs when stopping Claude sessions
- Repository deletion now works correctly when triggered from the web UI
- Added missing `routingLabels` and `projectKeys` fields to `CyrusConfigPayload` type in config-updater package
- Config handler now properly processes and saves label routing and project routing parameters when received from cyrus-hosted
- Fixed missing `dist/` directory in published packages by adding `"files": ["dist"]` to `cloudflare-tunnel-client` and `config-updater` package.json files
- All packages now include their compiled TypeScript output when installed from npm

### Changed
- **Linear Event Transport**: Refactored `cyrus-linear-webhook-client` to `cyrus-linear-event-transport` for simplified webhook handling
  - Package now directly registers /webhook endpoint with Fastify server
  - Supports dual verification modes: direct Linear webhooks (LINEAR_DIRECT_WEBHOOKS) and proxy authentication
  - Removed complex transport abstractions (WebhookTransport, BaseTransport) in favor of direct route registration
  - Routes registered after server startup for improved initialization flow
- **Simplified CLI startup**: Removed legacy onboarding flows and subscription validation
  - Cloudflare tunnel now starts automatically when CLOUDFLARE_TOKEN is present
  - Removed Pro plan prompts and customer validation code
  - Removed `billing` and `set-customer-id` commands
  - Streamlined `auth` command to focus on authentication only
  - All tunnel management now handled by SharedApplicationServer
- Updated @anthropic-ai/claude-agent-sdk from v0.1.28 to v0.1.31 - see [@anthropic-ai/claude-agent-sdk v0.1.31 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#0131)
- Updated @anthropic-ai/sdk from v0.67.0 to v0.68.0 - see [@anthropic-ai/sdk v0.68.0 changelog](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v0.67.0...sdk-v0.68.0)

### Removed
- **Subscription service**: Removed customer validation and subscription checking code
- **Billing commands**: Removed `billing` and `set-customer-id` CLI commands
- **Deprecated config parameter**: Removed `isLegacy` from EdgeConfig (replaced by setup waiting mode)

### Packages

#### cyrus-cloudflare-tunnel-client
- cyrus-cloudflare-tunnel-client@0.2.0

#### cyrus-config-updater
- cyrus-config-updater@0.2.0

#### cyrus-linear-event-transport
- cyrus-linear-event-transport@0.2.0

#### cyrus-claude-runner
- cyrus-claude-runner@0.2.0

#### cyrus-core
- cyrus-core@0.2.0

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.2.0

#### cyrus-edge-worker
- cyrus-edge-worker@0.2.0

#### cyrus-ai (CLI)
- cyrus-ai@0.2.0

## [0.1.60] - 2025-11-03

### Fixed
- Orchestrator label now enforces orchestrator procedure consistently - issues with the Orchestrator label always use the orchestrator-full procedure, even when receiving results from child sub-agents or processing new messages
- Suppressed unnecessary error logs when stopping Claude sessions

### Changed
- Updated @anthropic-ai/claude-agent-sdk from v0.1.28 to v0.1.31
- Updated @anthropic-ai/sdk from v0.67.0 to v0.68.0 - see [@anthropic-ai/sdk v0.68.0 changelog](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v0.67.0...sdk-v0.68.0)

### Packages

#### cyrus-core
- cyrus-core@0.0.21

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.32

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.41

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.25

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.0.4

#### cyrus-ai (CLI)
- cyrus-ai@0.1.60

## [0.1.59] - 2025-10-31

### Fixed
- Skip loading 'primary' subroutine prompt to eliminate ENOENT error in logs - the "primary" promptPath is a placeholder with no corresponding file

### Packages

#### cyrus-core
- cyrus-core@0.0.20

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.40

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.0.3

#### cyrus-ai (CLI)
- cyrus-ai@0.1.59

## [0.1.58] - 2025-10-29

### Added
- Orchestrator and sub-issue communication is now visible in Linear activity: feedback from orchestrator to sub-issues and results from sub-issues to orchestrator are posted as thoughts with clear context

### Fixed
- Procedure routing is now reset when resuming parent sessions from child completion, preventing excessive thought and action suppression logs
- Fixed bug where initial subroutine prompts were not applied to comment-triggered new sessions (only worked for assignment-based sessions)
- Improved routing classification to correctly identify test-related requests (e.g., "add unit tests", "fix failing tests") as code work instead of planning tasks

### Changed
- Debugger workflow now proceeds directly from bug reproduction to fix implementation without requiring manual approval
- All workflows (full-development, debugger-full, orchestrator-full) now end with concise summary instead of verbose summary
- Non-summary subroutines (debugger-fix, debugger-reproduction, verifications, git-gh) now explicitly avoid posting Linear comments and end with brief 1-sentence completion messages
- Orchestrator agents are now strongly discouraged from posting Linear comments to current issues; comments only used when triggering sub-agent sessions on child issues
- Orchestrator agents are explicitly instructed not to assign themselves (Cyrus) as a delegate when creating sub-issues
- Tool call result outputs are no longer wrapped in collapsible sections in Linear comments
- Concise summary format now uses collapsible sections for "Changes Made" and "Files Modified" to keep summaries brief
- Simple-question workflow now has two phases: investigation (gather information without answering) and answer formatting (provide markdown-formatted response)
- Initial subroutine prompts are now consistently loaded for all new sessions (assignment-based and comment-based), ensuring agents receive proper workflow guidance from the start
- Full-development workflow now starts with dedicated coding-activity subroutine (implementation and testing only, no git/gh operations)

### Packages

#### cyrus-core
- cyrus-core@0.0.20

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.40

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.0.3

#### cyrus-ai (CLI)
- cyrus-ai@0.1.58

## [0.1.57] - 2025-10-12

### Fixed
- Fixed missing `cyrus-simple-agent-runner` package publication that broke installation of cyrus-ai@0.1.56

### Packages

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.0.2

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.39

#### cyrus-ai (CLI)
- cyrus-ai@0.1.57

## [0.1.56] - 2025-10-12

### Added
- **Intelligent procedure routing**: Cyrus now automatically selects the best workflow for each task by analyzing the request content. Simple questions get quick answers, documentation edits proceed directly to implementation, and code changes get the full workflow with verifications and git operations. Uses fast "haiku" model for 10-second classification.
- **Modular subroutine system**: Workflows are composed of reusable subroutines (verifications, git-gh, concise-summary, verbose-summary) that can be mixed and matched based on the procedure selected.
- **Environment variable support in MCP configs**: MCP configuration files can now reference environment variables from repository `.env` files using `${VAR}` and `${VAR:-default}` syntax, making it easier to manage API tokens and other sensitive configuration values
- **Sora 2 video generation support**: Added custom MCP tools for OpenAI Sora 2 video generation with three tools: `mcp__sora-tools__sora_generate_video` to start video generation (supports text-to-video and image-to-video via `input_reference` parameter; reference images must match target video resolution and be in JPEG, PNG, or WebP format only), `mcp__sora-tools__sora_check_status` to poll job status, and `mcp__sora-tools__sora_get_video` to download completed videos
- **Simple agent runner package**: Added new `cyrus-simple-agent-runner` package for constrained agent queries that return one of a predefined set of responses (e.g., "yes", "no"). Features type-safe enumerated responses, comprehensive error handling, and progress tracking.
- **Image generation support**: Added GPT Image tools using OpenAI's Responses API with background mode. Two tools provide async image generation: `mcp__image-tools__gpt_image_generate` starts async image generation and returns a job ID, and `mcp__image-tools__gpt_image_get` checks status and downloads the image if ready (returns "not ready" if incomplete - agents can call again). Supports customizable size (1024x1024, 1536x1024, 1024x1536, auto), quality (low/medium/high/auto), background transparency, and output formats (PNG/JPEG/WebP). Uses gpt-5 model for tool invocation.

### Changed
- Updated @anthropic-ai/claude-agent-sdk from v0.1.13 to v0.1.14 - includes parity updates with Claude Code v2.0.14. See [@anthropic-ai/claude-agent-sdk v0.1.14 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#0114)
- **Breaking: OpenAI configuration naming**: Renamed repository config fields from `soraApiKey`/`soraOutputDirectory` to `openaiApiKey`/`openaiOutputDirectory` to reflect support for multiple OpenAI services (Sora and GPT Image). Update your repository config to use the new field names.

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.31

#### cyrus-core
- cyrus-core@0.0.19

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.38

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.24

#### cyrus-simple-agent-runner
- cyrus-simple-agent-runner@0.0.2

#### cyrus-ai (CLI)
- cyrus-ai@0.1.56

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
- cyrus-ndjson-client@0.0.21

#### cyrus-ai (CLI)
- cyrus-ai@0.1.53

## [0.1.52] - 2025-10-04

### Changed
- Version bump for all packages to ensure proper dependency resolution

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.27

#### cyrus-core
- cyrus-core@0.0.15

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.34

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.20

#### cyrus-ai (CLI)
- cyrus-ai@0.1.52

## [0.1.51] - 2025-10-04

### Fixed
- **Restored file-based settings loading**: Fixed regression from claude-agent-sdk update where CLAUDE.md files, settings files, and custom slash commands were not being loaded
  - Added explicit `settingSources: ["user", "project", "local"]` configuration to ClaudeRunner
  - This restores backwards compatibility with existing user configurations
  - See [Claude Code SDK Migration Guide](https://docs.claude.com/en/docs/claude-code/sdk/migration-guide#settings-sources-no-longer-loaded-by-default)

### Changed
- **Default model changed from opus to sonnet 4.5**: The default Claude model is now `sonnet` instead of `opus`
  - Fallback model changed from `sonnet` to `haiku`
  - Label-based model selection still available - users can add `opus`, `sonnet`, or `haiku` labels to issues to override the default
  - Affects all new sessions that don't explicitly specify a model in config
- Updated @anthropic-ai/claude-agent-sdk from v0.1.0 to v0.1.5 for latest Claude Agent SDK improvements
- Updated @anthropic-ai/sdk from v0.64.0 to v0.65.0 for latest Anthropic SDK improvements
  - Added support for Claude Sonnet 4.5 and context management features
  - See [@anthropic-ai/sdk v0.65.0 changelog](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v0.64.0...sdk-v0.65.0)

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.26

#### cyrus-core
- cyrus-core@0.0.14

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.33

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.19

#### cyrus-ai (CLI)
- cyrus-ai@0.1.51

## [0.1.50] - 2025-09-30

### Added
- **Global setup script support**: Added `global_setup_script` optional field in config.json
  - Runs before repository-specific `cyrus-setup.sh` when creating git worktrees
  - Supports ~ expansion for home directory paths
  - Same environment variables passed to both global and repository scripts (LINEAR_ISSUE_ID, LINEAR_ISSUE_IDENTIFIER, LINEAR_ISSUE_TITLE)
  - 5-minute timeout to prevent hanging scripts
  - Comprehensive error handling and logging for both global and repository scripts
  - Script failures don't prevent worktree creation
  - Cross-platform support (bash, PowerShell, cmd, bat)

- **Ephemeral agent activities for tool calls**: Standard tool calls now post ephemeral activities to Linear
  - Tool calls (except Task and TodoWrite) create ephemeral activities that disappear when replaced
  - Tool responses create non-ephemeral activities showing original tool name and input
  - Tool outputs are wrapped in `+++Tool Output` collapsible blocks (collapsed by default)
  - Tool errors display as "{ToolName} (Error)" for better clarity
  - Subtasks maintain arrow emoji (↪) prefix for visual hierarchy
  - TodoWrite tool results are skipped to prevent duplicate activities
  - Reduces visual clutter in Linear while preserving important information

### Changed
- **Linear SDK upgraded to v58.1.0**: Updated across all packages to support ephemeral agent activity field
  - Added `ephemeral: boolean` support for agent activities
  - Maintained backward compatibility with existing non-ephemeral activities

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.26

#### cyrus-core
- cyrus-core@0.0.14

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.33

#### cyrus-linear-webhook-client
- cyrus-linear-webhook-client@0.0.3

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.19

## [0.1.49] - 2025-09-29

### Changed
- **Migrated from Claude Code SDK to Claude Agent SDK**: Replaced `@anthropic-ai/claude-code` v1.0.128 with `@anthropic-ai/claude-agent-sdk` v0.1.0
  - Updated all imports and type references to use the new package name
  - Handled breaking change: SDK no longer uses Claude Code's system prompt by default - now explicitly requests Claude Code preset to maintain backward compatibility
  - No changes needed for settings sources as the codebase doesn't rely on automatic settings file loading
- Updated @anthropic-ai/sdk from v0.62.0 to v0.64.0 for latest Anthropic SDK improvements

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.25

#### cyrus-core
- cyrus-core@0.0.13

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.32

#### cyrus-ai (CLI)
- cyrus-ai@0.1.49

## [0.1.48] - 2025-01-11

### Added
- **Direct OAuth authorization support**: The CLI can now handle OAuth authorization directly when `LINEAR_DIRECT_WEBHOOKS=true`
  - New `/oauth/authorize` endpoint in SharedApplicationServer for self-hosted OAuth flow
  - Automatic OAuth code exchange when using direct webhooks mode
  - Support for custom Linear OAuth applications via `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` environment variables
  - Maintains backward compatibility with proxy-based OAuth for standard deployments

### Packages

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.31

#### cyrus-ai (CLI)
- cyrus-ai@0.1.48

## [0.1.47] - 2025-01-09

### Fixed
- Fixed webhook signature verification for LinearWebhookClient
  - Corrected signature verification to properly handle webhook payloads
  - Ensures webhook authenticity when using direct webhook forwarding mode
  - Resolves security validation issues in direct webhook configurations

### Packages

#### cyrus-linear-webhook-client
- cyrus-linear-webhook-client@0.0.2

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.30

#### cyrus-ai (CLI)
- cyrus-ai@0.1.47

## [0.1.46] - 2025-01-09

### Added
- **Dynamic webhook client selection**: Support for choosing between proxy-based and direct webhook forwarding
  - New environment variable `LINEAR_DIRECT_WEBHOOKS` to control webhook client selection
  - When `LINEAR_DIRECT_WEBHOOKS=true`, uses new `linear-webhook-client` package for direct webhook forwarding
  - When unset or `false`, uses existing `ndjson-client` for proxy-based webhook handling
  - Maintains full backward compatibility with existing deployments
- **Sub-issue assignee inheritance with workspace context**: Sub-issues created by orchestrator agents now automatically inherit the same assignee as their parent issue, with complete workspace awareness
  - Enhanced label-prompt-template to include assignee information (`{{assignee_id}}` and `{{assignee_name}}`)
  - Added workspace teams context (`{{workspace_teams}}`) with team names, keys, IDs, and descriptions
  - Added workspace labels context (`{{workspace_labels}}`) with label names, IDs, and descriptions  
  - Updated orchestrator prompt instructions to require `assigneeId` parameter in sub-issue creation
  - Modified EdgeWorker to fetch and inject Linear workspace data (teams, labels, assignee) into orchestrator context
- **Mandatory verification framework for orchestrator agents**: Enhanced parent-child delegation with executable verification requirements
  - Parent orchestrators can now access child agent worktrees for independent verification
  - **Orchestrator prompt v2.2.0** with mandatory verification requirements in sub-issue descriptions
  - Child agents must provide detailed verification instructions (commands, expected outcomes, visual evidence)
  - Parents gain filesystem permissions to child worktrees during verification process
  - No more "verification theater" - actual executable validation required before merging child work
- **@cyrus /label-based-prompt command**: New special command for mention-triggered sessions
  - Use `@cyrus /label-based-prompt` in comments to trigger label-based prompts instead of mention prompts
  - Automatically determines and includes appropriate system prompts based on issue labels
  - Maintains full backwards compatibility with regular `@cyrus` mentions
  - Logged as "label-based-prompt-command" workflow type for easy identification
- **Tool restriction configuration**: New `disallowedTools` configuration option to explicitly block specific tools
  - Can be configured at global, repository, prompt type, and label-specific levels
  - Follows same hierarchy as `allowedTools` (label > prompt defaults > repository > global)
  - No default disallowed tools - only explicitly configured tools are blocked
  - Environment variable support: `DISALLOWED_TOOLS` for global defaults
  - Passed through to Claude Code via `disallowedTools` option
- **New Linear MCP tool**: `linear_agent_session_create_on_comment` for creating agent sessions on root comments
  - Enables orchestrator agents to trigger sub-agents on existing issue comment threads
  - Must be used with root comments only (not replies) due to Linear API constraints
  - Maintains parent-child session mapping for proper feedback routing

### Changed
- Updated @anthropic-ai/claude-code from v1.0.90 to v1.0.95 for latest Claude Code improvements. See [Claude Code v1.0.95 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#1095)
- Replaced external cyrus-mcp-tools MCP server with inline tools using SDK callbacks for better performance
- Cyrus tools (file upload, agent session creation, feedback) now run in-process instead of via separate MCP server
- Enhanced orchestrator prompt to explicitly require reading/viewing all screenshots taken for visual verification

### Removed
- Removed cyrus-mcp-tools package in favor of inline tool implementation

## [0.1.45] - 2025-08-28

### Added
- New `cyrus-mcp-tools` package providing MCP tools for Linear integration
  - File upload capability: Upload files to Linear and get asset URLs for use in issues and comments
  - Agent session creation: Create AI/bot tracking sessions on Linear issues
  - **Give feedback tool: Allows parent sessions to send feedback to child sessions**
  - Automatically available in all Cyrus sessions without additional configuration
- PostToolUse hook integration for tracking parent-child agent session relationships
  - Automatically captures child agent session IDs when linear_agent_session_create tool is used
  - **Triggers child session resumption when linear_agent_give_feedback tool is used**
  - Maintains mapping of child sessions to parent sessions for hierarchical tracking
  - **Persistent storage of child-to-parent mappings across restarts**
  - Child session results are automatically forwarded to parent sessions upon completion
- New "orchestrator" label system prompt type
  - Joins existing "builder", "debugger", and "scoper" labels as a default option
  - Configured with read-only tools (cannot directly edit files)
  - Specializes in coordination and oversight of complex development tasks
  - Automatically triggered by "Orchestrator" label on Linear issues
- **Label-based Claude model selection**: You can now override the Claude model used for specific issues by adding labels
  - Add "opus", "sonnet", or "haiku" label to any Linear issue to force that model
  - Model labels take highest priority (overrides both repository and global settings)
  - Case-insensitive label matching for flexibility
  - Automatically sets appropriate fallback models (opus→sonnet, sonnet→haiku, haiku→haiku)

### Changed
- Updated @anthropic-ai/claude-code from v1.0.88 to v1.0.89 for latest Claude Code improvements. See [Claude Code v1.0.89 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#1089)
- Upgraded @linear/sdk from v38/v55 to v58.0.0 across all packages for latest Linear API features
- Enhanced ClaudeRunner and EdgeWorker to support Claude Code SDK hooks for tool interception

### Packages

#### cyrus-mcp-tools
- cyrus-mcp-tools@0.3.0 - Already published (not part of this release)

#### cyrus-core
- cyrus-core@0.0.11

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.23

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.28

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.17

#### cyrus-ai (CLI)
- cyrus-ai@0.1.45

## [0.1.44] - 2025-08-19

### Changed
- Updated @anthropic-ai/claude-code dependency to use exact version (1.0.83) instead of caret range for improved consistency
- Updated CLAUDE.md documentation with clearer MCP Linear integration testing instructions

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.22

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.27

#### cyrus-ai (CLI)
- cyrus-ai@0.1.44

## [0.1.43] - 2025-08-18

### Added
- Model configuration support for Claude Pro users
  - Configure Claude model selection (priority order: env vars → repository config → global config → defaults)
  - Environment variables: `CYRUS_DEFAULT_MODEL` and `CYRUS_DEFAULT_FALLBACK_MODEL`
  - Global config: `defaultModel` and `defaultFallbackModel` in `~/.cyrus/config.json`
  - Repository-specific: `model` and `fallbackModel` fields per repository
  - Defaults: `"opus"` (primary) and `"sonnet"` (fallback)
  - Resolves errors for Claude Pro users who lack Opus model access

### Changed
- Updated @anthropic-ai/claude-code from v1.0.81 to v1.0.83 for latest Claude Code improvements. See [Claude Code v1.0.83 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#1083)

### Fixed
- Fixed git worktree creation failures for sub-issues when parent branch doesn't exist remotely
  - Added proper remote branch existence checking before attempting worktree creation
  - Gracefully falls back to local parent branch or default base branch when remote parent branch is unavailable

### Packages

#### cyrus-claude-runner  
- cyrus-claude-runner@0.0.21

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.26

#### cyrus-ai (CLI)
- cyrus-ai@0.1.43

## [0.1.42] - 2025-08-15

### Changed
- Updated @anthropic-ai/claude-code from v1.0.77 to v1.0.80 for latest Claude Code improvements. See [Claude Code v1.0.80 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#1080)
- Updated @anthropic-ai/sdk from v0.59.0 to v0.60.0 for latest Anthropic SDK improvements

### Fixed
- Fixed issue where duplicate messages appeared in Linear when Claude provided final responses
  - Added consistent LAST_MESSAGE_MARKER to all prompt types to ensure Claude includes the special marker in final responses
  - Marker is automatically removed before posting to Linear, preventing duplicate content

### Packages

#### cyrus-core
- cyrus-core@0.0.10

#### cyrus-claude-runner  
- cyrus-claude-runner@0.0.20

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.25

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.16

#### cyrus-ai (CLI)
- cyrus-ai@0.1.42

## [0.1.41] - 2025-08-13

### Added
- Dynamic tool configuration based on system prompt labels
  - Restrict Claude's tools per task type: give debugger mode only read access, builder mode safe tools, etc.
  - Use case: scoper can only read files, debugger can't use Bash, builder gets full access
  - Use presets (`"readOnly"`, `"safe"`, `"all"`) or custom tool lists in your `labelPrompts` config
  - Improves security and keeps Claude focused on the right tools for each job
  - See [Configuration docs](https://github.com/ceedaragents/cyrus#configuration) for setup details

### Changed
- Updated @anthropic-ai/claude-code from v1.0.72 to v1.0.73 for latest Claude Code improvements

### Fixed
- Fixed Windows compatibility issues that caused agent failures on Windows systems
  - Replaced Unix-specific `mkdir -p` commands with cross-platform Node.js `mkdirSync` 
  - Implemented intelligent shell script detection supporting Windows (.ps1, .bat, .cmd) and Unix (.sh) scripts
  - Added graceful fallback for Windows users with Git Bash/WSL to still use bash scripts
  - Resolves "A subdirectory or file -p already exists" and "bash command not found" errors
- Resolved issue where Cyrus would fail to respond when it was initially delegated when the receiver was down
  - Now properly creates new sessions when prompted if none existed
  - Sessions are correctly initialized even when no prior session history exists
  - Improved code organization and type safety in session handling logic

### Packages

#### cyrus-core
- cyrus-core@0.0.10

#### cyrus-claude-runner  
- cyrus-claude-runner@0.0.19

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.24

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.16

#### cyrus-ai (CLI)
- cyrus-ai@0.1.41

## [0.1.40] - 2025-08-10

### Added
- Customer subscription validation for Cyrus Pro users
  - Automatically checks subscription status when using the default proxy with a customer ID
  - Blocks access if subscription is expired, cancelled, or invalid
  - Shows appropriate messages for returning customers vs new customers
  - Validates subscription when setting customer ID via `cyrus set-customer-id` command
- Label-based repository routing - Route Linear issues to different git repositories based on their labels
  - New `routingLabels` configuration option allows specifying which labels should route to a specific repository
  - Useful when multiple repositories handle issues from the same Linear team (e.g., backend vs frontend repos)
  - Label routing takes precedence over team-based routing for more granular control

### Changed
- Updated Linear SDK from v54 to v55.1.0 to support Agent Activity Signals
  - Stop button in Linear UI now sends a deterministic `stop` signal that Cyrus responds to immediately
  - When you click the stop button while Cyrus is working, it will cleanly halt all operations and confirm the stop action
  - The stop signal implementation ensures no work continues after the stop is requested
- Updated Anthropic AI SDK from v0.57.0 to v0.59.0 and Claude Code from v1.0.61 to v1.0.72 for improved Claude integration

### Packages

#### cyrus-core
- cyrus-core@0.0.9

#### cyrus-claude-runner  
- cyrus-claude-runner@0.0.18

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.23

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.15

#### cyrus-ai (CLI)
- cyrus-ai@0.1.40

## [0.1.39] - 2025-08-08

### Changed
- Simplified initial setup by removing configuration prompts for MCP, labels, Linear teams, allowed tools, and workspace directory
  - MCP configuration is now optional with no default prompt
  - Allowed tools default to all standard tools plus Bash(git:*) and Bash(gh:*) for immediate productivity
  - Label-based system prompts now have defaults: "Bug" for debugger mode, "Feature,Improvement" for builder mode, and "PRD" for scoper mode
  - Team-based routing defaults to all workspace issues (no team filtering)
  - Workspace directory automatically uses `~/.cyrus/workspaces/<repo-name>`
  - Streamlined first-time user experience with sensible defaults

### Added
- Configuration documentation in README explaining all customizable settings
- Link to configuration docs in CLI output after setup completion

### Fixed
- Fixed duplicate OAuth authorization messages during Linear login flow while ensuring browser still opens automatically

### Packages

#### cyrus-core
- cyrus-core@0.0.8

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.17

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.22

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.15

#### cyrus-ai (CLI)
- cyrus-ai@0.1.39

## [0.1.38] - 2025-08-06

### Added
- Native Linear attachments (like Sentry error links) are now included in the issue context sent to Claude
  - Cyrus now fetches attachments using Linear's native attachment API
  - Attachments appear in a dedicated "Linear Issue Links" section in the prompt
  - Particularly useful for Sentry error tracking links and other external integrations
- New command **`cyrus add-repository`** - Add a new repository configuration, thanks new contributor @Maxim-Filimonov !
- Attachment support for comments - Cyrus now downloads and provides access to attachments added in Linear comments
  - Attachments are automatically downloaded when users post comments with URLs or files
  - Downloaded to `~/.cyrus/<workspace>/attachments` directory
  - Attachment manifest is generated and included in Claude's prompt
  - Attachments directory is always available to Claude during sessions
- Differentiation between issue delegation and @ mentions for more focused responses
  - @ mentions now trigger focused responses without system prompts
  - Delegations continue to use full system prompts for comprehensive task handling
  - Aligns with Linear's expected agent activity behavior
- Subscription management built right into the CLI (because who wants another dashboard?)
  - `cyrus billing` - Opens your Stripe portal to manage subscription, payment methods, and download invoices
  - `cyrus set-customer-id` - Saves your customer ID after signup (copy-paste friendly)
  - Interactive prompt on startup if you're using our proxy without a subscription
  - Self-hosting option for the DIY crowd who prefer their own Linear app and infrastructure
  - existed in v0.1.34 but was missing since then

### Fixed
- Fixed attachments not being accessible to Claude during active streaming sessions
  - Pre-create attachments directory for every session to ensure future attachments are accessible
  - Always include attachments directory in allowedDirectories configuration
- Fixed issue where messages from @ Cyrus mention comments weren't being added to context
- Fixed issue where sub-issue base branches weren't being added to the user-prompt template, causing Cyrus to create PRs against the default branch instead

### Packages

#### cyrus-core
- cyrus-core@0.0.8

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.16

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.21

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.15

#### cyrus-ai (CLI)
- cyrus-ai@0.1.38

## [0.1.37] - 2025-08-03

### Fixed
- Fixed "RateLimit exceeded" and `Cannot query field "agentContext" on type "AgentActivity".` errors when interacting with Linear API by updating SDK from v52 to v54
  - Linear API had breaking changes that caused compatibility issues with SDK v52
  - The outdated SDK was triggering excessive API calls leading to rate limit errors
  - Upgrading to v54 resolves these compatibility issues and restores normal operation

### Packages

#### cyrus-core
- cyrus-core@0.0.8

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.15

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.20

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.15

#### cyrus-ai (CLI)
- cyrus-ai@0.1.37

## [0.1.36] - 2025-08-01

### Added
- Instant response is now sent when receiving follow-up messages in an existing conversation, providing immediate feedback that Cyrus is working on the request
  - Shows "I've queued up your message as guidance" when Cyrus is still processing a previous request
  - Shows "Getting started on that..." when Cyrus is ready to process the new request immediately
- Parent branch inheritance for sub-issues - sub-issue branches now automatically use their parent issue's branch as the base instead of the default repository branch
  - Maintains proper Git hierarchy matching Linear's issue structure
  - Gracefully falls back to default base branch if parent branch doesn't exist
  - Clear logging shows branch inheritance decisions
- Model notification at thread initialization - Cyrus now announces which Claude model is being used (e.g., "Using model: claude-3-opus-20240229") when starting work on an issue
- Task tool execution markers in Linear comments - Cyrus now clearly indicates when automated Task tools are running
  - Tools invoked within a Task display "↪ ToolName" to indicate they're part of the Task
  - Shows "✅ Task Completed" when the Task finishes and displays the output from the Task

### Packages

#### cyrus-core
- cyrus-core@0.0.7

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.14

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.19

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.14

#### cyrus-ai (CLI)
- cyrus-ai@0.1.36
## [0.1.35-alpha.0] - 2025-07-27

### Added
- Instant acknowledgment responses when Cyrus receives a request, providing immediate feedback to users
- Role mode notifications when issue labels trigger specific workflows (e.g., "Entering 'debugger' mode because of the 'Bug' label")
- You can now append custom instructions to Claude's system prompt via `appendInstruction` in repository config (~/.cyrus/config.json) - because sometimes Claude needs a gentle reminder that your variable names are art, not accidents

### Changed
- TodoWrite tool messages are now displayed as "thoughts" instead of "actions" in Linear for better visual organization

### Packages

#### cyrus-core
- cyrus-core@0.0.6-alpha.0

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.13-alpha.0

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.18-alpha.0

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.13-alpha.0

#### cyrus-ai (CLI)
- cyrus-ai@0.1.35-alpha.0

## [0.1.33] - 2025-07-11

### CLI
- cyrus-ai@0.1.33

### Fixed
- Made conversation history of threads be resumable after Cyrus restarts
- Fixed the issue with continuity of conversation in a thread, after the first comment

### Packages

#### cyrus-core
- cyrus-core@0.0.6

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.13

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.18

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.13

## [0.1.32] - 2025-07-09

### CLI
- cyrus-ai@0.1.32

### Fixed
- Missing prompt template file in published package (the one thing you need to actually run the thing)

### Packages

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.17
  - Fixed missing prompt-template-v2.md in package files

## [0.1.31] - 2025-07-09

### CLI
- cyrus-ai@0.1.31

### Added
- Work on multiple tasks within a single Linear issue - each comment thread maintains its own Claude session, letting you tackle different parts of a problem in parallel without context mixing. New root comments start focused sessions that see the full conversation history in a threaded view (just like Linear's UI) while concentrating on your specific request
- Automatic ngrok tunnel setup for external access
  - No more manual port forwarding or reverse proxy setup required
  - Cyrus will ask for your ngrok auth token on first run and handle the rest
  - Free ngrok account required (sorry, we can't make the internet work by magic alone)
  - Skip ngrok setup if you prefer to handle networking yourself
- Webhook debugging via `CYRUS_WEBHOOK_DEBUG=true` environment variable - see exactly what Linear is (or isn't) sending you

### Fixed
- Fresh startup no longer crashes with "EdgeWorker not initialized" error when trying to connect to Linear
- OAuth flow now works properly on first run (turns out asking for credentials before having a way to receive them was... problematic)
- Git worktrees now work with local-only repositories (no more "fatal: 'origin' does not appear to be a git repository" when you're just trying to test things locally)
- Webhooks now register with the correct URL (ngrok/public URL instead of localhost)

### Packages

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.16
- Added ngrok tunnel support for automatic public URL generation
- Fixed webhook URL registration to use public URLs
- Added getPublicUrl() method to SharedApplicationServer

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.12
- Fixed webhook URL registration to use external server's public URL when available

## [0.1.30] - 2025-07-07

### CLI
- cyrus-ai@0.1.30

### Fixed
- Fixed critical crash issue where subprocess failures would bring down the entire application
  - Added global error handlers to prevent uncaught exceptions from terminating the process
  - Improved error isolation for individual Claude sessions - failures no longer affect other running sessions
  - Enhanced error logging with detailed stack traces for better debugging

### Packages

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.15

## [0.1.28] - 2025-07-06

### CLI
- cyrus-ai@0.1.28

### Fixed
- Fixed critical streaming hang where sessions would never complete
  - Auto-completes streaming prompt when Claude sends result message
  - Prevents infinite wait in for-await loop

## [0.1.27] - 2025-07-06

### CLI
- cyrus-ai@0.1.27

### Changed
- Updated to use edge-worker 0.0.12 with fixed claude-runner dependency

## [0.1.26] - 2025-07-06

### CLI
- cyrus-ai@0.1.26

### Fixed
- Fixed critical streaming hang issue where Claude Code would block waiting for messages
  - Corrected `abortController` placement in query options (was at wrong nesting level)
  - Fixed system prompt parameter name (now uses `customSystemPrompt` as expected by Claude Code)

### Added
- Added `appendSystemPrompt` option to ClaudeRunner config for extending default system prompt

## [0.1.25] - 2025-07-06

### CLI
- cyrus-ai@0.1.25

### Fixed
- Fixed streaming session detection to prevent "I've queued up your message..." when sessions have completed
- Improved isStreaming() method to check both streaming state and session running status


## [0.1.23] - 2025-07-06

### CLI
- cyrus-ai@0.1.23

### Fixed
- Fixed streaming input sessions not properly cleaning up after completion
  - Resolves issue where "I've queued up your message..." appeared even after sessions had resolved
  - Properly closes input streams when Claude sessions complete naturally

### Added
- Added `cyrus check-tokens` command to validate all Linear OAuth tokens across repositories
- Added `cyrus refresh-token` command with OAuth flow integration to renew expired tokens
- Improved error handling for expired Linear tokens with graceful degradation
  - Shows clear error messages with suggested resolution steps
  - Continues running with valid repositories when some tokens are expired

### Changed
- Configuration file location moved from `.edge-config.json` in current directory to `~/.cyrus/config.json`
  - Automatically migrates existing `.edge-config.json` files to the new location
  - Uses standard user configuration directory for better cross-platform compatibility
  - Reports migration status when detected
- Default workspace directory changed from `{repository}/workspaces` to `~/.cyrus/workspaces/{repo-name}`
  - Centralizes all cyrus-related files in the user's home directory
  - Uses sanitized repository names as namespace folders
  - Existing configurations remain unchanged

## [0.1.22] - 2025-07-05

### CLI
- cyrus-ai@0.1.22

### Added
- Automatic Linear MCP (Model Context Protocol) server integration
  - Claude can now use Linear API tools directly within sessions
  - Automatically configures `@tacticlaunch/mcp-linear` server with repository's Linear token
  - Adds 30+ Linear MCP tools for issue management, comments, projects, and more
  - No additional configuration needed - works out of the box with existing Linear tokens

### Changed
- ClaudeRunner now supports array of MCP config paths for composable configurations
- ClaudeRunner supports inline MCP server configurations alongside file-based configs
- MCP configurations from files and inline sources are merged together

### Fixed
- Fixed webhook signature verification failures after restarting cyrus by extending edge worker registration TTL from 1 hour to 90 days
  - Resolves "Webhook signature verification failed for all registered handlers" error that occurred when cyrus was stopped and restarted
  - Edge worker registrations in the proxy now persist for 90 days instead of expiring after 1 hour

### Improved
- New comments on Linear issues queue up when Cyrus is already busy working, so that you can send multiple in a row ([#77](https://github.com/ceedaragents/cyrus/pull/77)) (now feed into existing Claude sessions instead of killing and restarting the session

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.8

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.10

## [0.1.21] - 2025-07-05

### CLI
- cyrus-ai@0.1.21

### Added
- Added `CYRUS_HOST_EXTERNAL` environment variable to enable external server access ([#78](https://github.com/ceedaragents/cyrus/pull/78))
  - Set to `true` to listen on `0.0.0.0` (all interfaces) instead of `localhost`
  - Enables Docker container deployment and external webhook access scenarios
  - Maintains backward compatibility with `localhost` as default

### Changed
- **BREAKING**: Renamed `CYRUS_WEBHOOK_BASE_URL` to `CYRUS_BASE_URL` for clearer naming
  - **Action Required**: Update environment configuration to use `CYRUS_BASE_URL` instead of `CYRUS_WEBHOOK_BASE_URL`
  - **Legacy Support**: `CYRUS_WEBHOOK_BASE_URL` is still supported for backward compatibility but deprecated
  - The variable serves both webhook and OAuth callback purposes since they run on the same server

### Packages

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.9

## [0.1.19] - 2025-07-04

### CLI
- cyrus-ai@0.1.19

### Added
- Added `CYRUS_OAUTH_CALLBACK_BASE_URL` environment variable to configure OAuth callback URL (defaults to `http://localhost:3457`) ([#69](https://github.com/ceedaragents/cyrus/pull/69))
- Added `CYRUS_OAUTH_CALLBACK_PORT` environment variable to configure OAuth callback port (defaults to `3457`)
- OAuth callback URL is now fully configurable for different deployment environments (Docker, remote development, custom domains)
- Supports `--env-file=path` option to load environment variables from custom file
- Added `CYRUS_BASE_URL` environment variable to configure base URL for edge workers ([#74](https://github.com/ceedaragents/cyrus/pull/74))
- Added `CYRUS_WEBHOOK_PORT` environment variable to configure webhook port (defaults to random port 3000-3999)
- Implemented shared webhook server architecture to eliminate port conflicts between multiple Linear tokens

### Changed
- **BREAKING**: Migrated from Server-Sent Events (SSE) to webhook-only architecture ([#74](https://github.com/ceedaragents/cyrus/pull/74))
  - **Action Required**: Edge workers now receive webhooks instead of SSE streams
  - **Action Required**: Set `CYRUS_BASE_URL` environment variable if using custom deployment URLs (e.g., ngrok tunnel, server domain)
  - **Action Required**: Set `CYRUS_WEBHOOK_PORT=3456` environment variable to ensure consistent webhook port
  - **Action Required**: Ensure edge workers can receive inbound HTTP requests on webhook ports
- Renamed repository setup script from `secretagentsetup.sh` to `cyrus-setup.sh`

### Fixed
- Resolved SSE connection reliability issues by migrating to webhook architecture
- Improved disconnection message formatting
- Removed duplicate disconnection logging

### Packages

#### cyrus-claude-runner
- Upgraded @anthropic-ai/claude-code dependency to version 1.0.31

## [0.0.3] - 2025-06-17

### Packages
- cyrus-claude-runner@0.0.3
- cyrus-core@0.0.3
- cyrus-edge-worker@0.0.3
- cyrus-ndjson-client@0.0.3

Initial changelog entry

## [0.1.9] - 2025-06-17

### CLI
- cyrus-ai@0.1.9

Initial changelog entry
