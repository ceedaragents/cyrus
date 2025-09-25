Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Goals and scope
- [x] Config schema changes with examples
- [x] Runner abstraction overview
- [x] Label routing + selection order
- [x] Integration details (Claude, Codex, OpenCode)
- [x] Open Questions resolved
- [x] Links to sub-guides
- [ ] Final approval

# Cyrus Multi-CLI Agent Support (Claude, Codex, OpenCode)

## Goal

Extend Cyrus beyond Claude Code by adding first-class support for additional local coding agents:

- OpenAI Codex CLI (openai/codex)
- OpenCode CLI (sst/opencode)

Users can:

- Set a default CLI and a default model per CLI (globally and per repo)
- Connect an OpenAI account (API key) for Codex and OpenCode
- Route Linear issues to a specific CLI based on labels

This spec outlines UX, config, architecture, adapters, and concrete changes across this repo.

For step-by-step, junior‑friendly guides, see [docs/specs/README.md](specs/README.md).

## High-Level Design

Introduce a "Runner" abstraction so EdgeWorker can orchestrate any agent CLI with a consistent interface. We will:

- Wrap the current Claude flow behind a ClaudeRunnerAdapter
- Add CodexRunnerAdapter using `codex exec` (non-interactive/CI mode)
- Add OpenCodeRunnerAdapter via OpenCode’s local HTTP API (server endpoints + SSE)
- Add selection logic to pick a runner per issue based on labels, per-repo override, or global defaults

Initial implementation targets correctness and simple streaming (when available). We preserve all current Claude behavior and configuration; new features are opt-in.

## User Experience

- Global defaults live in `~/.cyrus/config.json`
  - default CLI (e.g. `"claude"`, `"codex"`, or `"opencode"`)
  - default model per CLI
  - per-CLI settings (e.g. Codex approval policy, sandbox, OpenCode server URL)
- Per-repo overrides in the existing `repositories[]` entries
- Label-based routing can pick a CLI and optionally override model for that CLI
- New CLI commands in `cyrus` for connecting OpenAI and setting defaults

## Configuration Schema Changes

Add the following to the Edge app config (read from `~/.cyrus/config.json`). These augment existing fields; Claude-only fields continue to work.

Top-level additions (EdgeConfig):

- `defaultCli`: "claude" | "codex" | "opencode"
- `cliDefaults`:
  - `claude?: { model?: string, fallbackModel?: string }`
  - `codex?: { model?: string, approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never", sandbox?: "read-only" | "workspace-write" | "danger-full-access" }`
  - `opencode?: { provider?: string, model?: string, serverUrl?: string }`
- `credentials?: { openaiApiKey?: string }`  // optional; env vars preferred

RepositoryConfig additions (packages/edge-worker/src/types.ts):

- `runner?: "claude" | "codex" | "opencode"`  // default CLI for this repository
- `runnerModels?: { claude?: { model?: string, fallbackModel?: string }, codex?: { model?: string }, opencode?: { provider?: string, model?: string } }`
- `labelAgentRouting?: Array<{ labels: string[], runner: "claude" | "codex" | "opencode", model?: string, provider?: string }>`

Notes:

- Existing `model`/`fallbackModel` fields remain for Claude and are read as the default Claude settings for the repo. New `runnerModels.claude` will override those if present.
- Global `promptDefaults` and `labelPrompts` continue to work, independently from runner selection. Prompt choice (debugger/builder/scoper) stays Claude-centric; only which runner is used changes per routing.

### Example Config

```json
{
  "defaultCli": "claude",
  "cliDefaults": {
    "claude": { "model": "claude-3.7-sonnet", "fallbackModel": "claude-3.5-sonnet" },
    "codex": { "model": "o3", "approvalPolicy": "never", "sandbox": "workspace-write" },
    "opencode": { "provider": "openai", "model": "o4-mini", "serverUrl": "http://localhost:17899" }
  },
  "credentials": { "openaiApiKey": "env:OPENAI_API_KEY" },
  "repositories": [
    {
      "id": "workspace-123",
      "name": "my-app",
      "repositoryPath": "/path/to/repo",
      "baseBranch": "main",
      "linearWorkspaceId": "abc123",
      "linearToken": "...",
      "workspaceBaseDir": "/Users/me/.cyrus/workspaces/my-app",
      "runner": "codex",
      "runnerModels": {
        "codex": { "model": "o3-mini" },
        "opencode": { "provider": "openai", "model": "o3-mini" }
      },
      "labelAgentRouting": [
        { "labels": ["PRD"], "runner": "claude", "model": "claude-3.7-sonnet" },
        { "labels": ["Performance"], "runner": "codex", "model": "o3" },
        { "labels": ["OpenSource"], "runner": "opencode", "provider": "openai", "model": "o4-mini" }
      ],
      "labelPrompts": {
        "debugger": { "labels": ["Bug"], "allowedTools": "all" },
        "builder": { "labels": ["Feature"], "allowedTools": "safe" },
        "scoper": { "labels": ["PRD"], "allowedTools": "readOnly" }
      }
    }
  ]
}
```

## Runner Abstraction

Create a minimal cross-CLI runner interface implemented by adapters:

```ts
type RunnerType = "claude" | "codex" | "opencode";

interface RunnerConfig {
  type: RunnerType;
  cwd: string;                 // workspace path
  prompt: string;              // initial prompt (already built by EdgeWorker)
  model?: string;              // per-runner model identifier
  provider?: string;           // for opencode
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"; // codex
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never"; // codex
  mcpServers?: McpServerConfig[]; // when applicable
}

type RunnerEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input?: unknown }
  | { kind: "result"; summary?: string } // terminal event
  | { kind: "error"; error: Error };

interface Runner {
  start(onEvent: (e: RunnerEvent) => void): Promise<{ sessionId?: string }>; // returns when started (or immediately for batch)
  stop(): Promise<void>;
}
```

Adapters:

- ClaudeRunnerAdapter: wraps `cyrus-claude-runner` (no behavior change)
- CodexRunnerAdapter: spawns `codex exec` with the given prompt and flags; emits `text` chunks by reading stdout, final `result` on exit
- OpenCodeRunnerAdapter: calls local server API (`/session`, `/session/:id/command`) and subscribes to `/event` SSE; maps events to RunnerEvent

## Runner Selection Logic

Add a resolver that selects the runner and model for a given issue:

Order of precedence (first match wins):

1. `repository.labelAgentRouting` labels
2. Repo-level `runner`/`runnerModels`
3. Global `defaultCli`/`cliDefaults`

If multiple label routing rules match, take the earliest match in `labelAgentRouting`.

## Integration Details by CLI

### Claude (existing)

No changes to Claude flows besides being invoked via the abstraction. We continue to:

- Build system/user prompts from `labelPrompts` and prompt templates
- Configure allowed tools and MCP servers
- Stream SDK messages back to Linear via AgentSessionManager

Code touchpoints:

- packages/edge-worker/src/EdgeWorker.ts — replace direct `new ClaudeRunner` usage with RunnerFactory
- packages/edge-worker/src/AgentSessionManager.ts — remains main postback for Claude (see “Messaging unification” below)

### Codex CLI (openai/codex)

References:

- CLI: https://github.com/openai/codex
- Non-interactive mode: `codex exec "..."` (docs/getting-started.md, docs/advanced.md)
- Flags: `--model/-m`, `--cd`, `--approval-policy`, `--sandbox`, `--full-auto`
- Auth: `codex login --api-key $OPENAI_API_KEY` (docs/authentication.md)

Invocation (baseline):

- Command: `codex exec --cd <workspace> -m <model> --approval-policy never --sandbox workspace-write "<prompt>"`
- Environment: `OPENAI_API_KEY` set if using API key auth
- Output handling: capture stdout/stderr, stream lines as `RunnerEvent { kind: "text" }`, emit `result` on process exit
- Optional resume: future enhancement via `codex exec resume --last` to continue prior context

Sandbox/Approvals mapping from Cyrus tool presets:

- readOnly → `--sandbox read-only`, `--approval-policy never` (model won’t escalate; emphasize read‑only in the prompt)
- safe → `--sandbox workspace-write`, `--approval-policy on-request`
- all → `--sandbox danger-full-access`, `--approval-policy never`

Notes:

- Codex doesn’t expose a JSON event stream by default; first pass will stream stdout lines to Linear
- Codex manages file edits and git; our worktree isolation remains the right safety boundary

### OpenCode CLI (sst/opencode)

References:

- Repo: https://github.com/sst/opencode (server code in `packages/opencode/src/server/server.ts`)
- Server API endpoints: sessions, commands, auth; SSE stream at `/event`

Auth:

- Use `PUT /auth/:id` with body per `Auth.Info` to set credentials; for OpenAI: `{ "type": "api", "key": "sk-..." }` at id `openai`

Provider/Model Selection:

- Discover providers via `GET /config/providers`
- For a prompt, use `POST /session` → `POST /session/:id/command` with body matching `SessionPrompt.CommandInput` (see SessionPrompt.PromptInput)
- `PromptInput.model` accepts `{ providerID, modelID }`

Streaming:

- Subscribe to `GET /event` (SSE); filter by session id
- Map streamed message parts (`MessageV2`) to `RunnerEvent` text/tool events

Server URL:

- Default from `cliDefaults.opencode.serverUrl`; user can override per repo
- The adapter should detect connection errors and provide guidance to start OpenCode locally

## Messaging Unification to Linear

Today, `AgentSessionManager` is Claude-specific and expects `cyrus-claude-runner` SDK messages. We need a minimal bridge so other runners can post updates:

Phase 1 (minimal):

- Add a generic posting path in EdgeWorker that:
  - Posts an instant acknowledgment thought (existing)
  - Streams textual chunks from Codex/OpenCode as simple “assistant text” thoughts to Linear agent sessions
  - Posts a final summary on completion
- Do not attempt to reconstruct tool-use graphs for non-Claude runners initially

Phase 2 (better streaming):

- Extend AgentSessionManager to accept a simplified `RunnerEvent` stream and render richer entries when possible (e.g., OpenCode tool execution events)

Files to adjust:

- packages/edge-worker/src/EdgeWorker.ts — branch to a generic “postAssistantText” path for non-Claude
- packages/edge-worker/src/AgentSessionManager.ts — optionally add helpers for posting plain text chunks tied to a session

## Selection Flow in EdgeWorker

Where: `packages/edge-worker/src/EdgeWorker.ts`

New steps around current session creation:

1. Fetch labels for the issue (existing)
2. Determine prompt type/system prompt from labels (existing)
3. Determine runner+model from `labelAgentRouting` → repo runner override → global defaults
4. Build the initial prompt string (existing logic; reused for all CLIs)
5. Create the runner via factory and start it
6. Pump events to Linear using either the Claude path or the generic text path

## Cyrus CLI Additions (apps/cli)

Add subcommands to `apps/cli/app.ts`:

- `cyrus connect-openai` — prompts for `OPENAI_API_KEY`, stores in `~/.cyrus/config.json` under `credentials.openaiApiKey` (or uses env vars), applies to Codex (`codex login --api-key`) and OpenCode (`PUT /auth/openai`)
- `cyrus set-default-cli <claude|codex|opencode>` — updates `defaultCli`
- `cyrus set-default-model <cli> <model>` — updates `cliDefaults[cli].model`

Wizard updates:

- During `add-repository`, ask for default runner for this repo and per-CLI model overrides (optional)

## Concrete Code Changes (by file)

Core types and config:

- packages/edge-worker/src/types.ts
  - Add fields: `runner`, `runnerModels`, `labelAgentRouting`
  - Add EdgeConfig fields: `defaultCli`, `cliDefaults`, `credentials?`

Runner abstraction and adapters:

- New package: `packages/runner` (or `packages/agent-runner`)
  - Exports `Runner`, `RunnerConfig`, `RunnerEvent`, `RunnerFactory`
  - Implements `ClaudeRunnerAdapter` (wrap `cyrus-claude-runner`)
  - Implements `CodexRunnerAdapter` (spawns `codex exec`)
  - Implements `OpenCodeRunnerAdapter` (HTTP + SSE)

Edge worker orchestration:

- packages/edge-worker/src/EdgeWorker.ts
  - Add `resolveRunnerSelection(labels, repo, global)`
  - Replace direct Claude instantiation with `RunnerFactory.create()`
  - Add generic streaming-to-Linear handler for non-Claude

Session messaging bridge (optional, Phase 1 minimal):

- packages/edge-worker/src/AgentSessionManager.ts
  - Add a method `postAssistantText(linearAgentActivitySessionId: string, text: string)`
  - Use for Codex/OpenCode streaming

CLI app changes:

- apps/cli/app.ts
  - Extend `EdgeConfig` type and save/load paths
  - Add new commands and prompts described above
  - Persist `cliDefaults` and repo `runner` settings

Docs/UI:

- README: add sections for multi-CLI, OpenAI connect, and label-based runner routing (follow-up PR)

## Auth & Accounts

OpenAI Account for Codex:

- Headless-friendly: run `codex login --api-key "$OPENAI_API_KEY"` before using Codex
- Cyrus command `cyrus connect-openai` can run this automatically if the CLI is available, otherwise instruct the user

OpenAI Account for OpenCode:

- Call `PUT /auth/openai` with `{ type: "api", key: "..." }` to set API credentials in OpenCode’s store
- Optionally set Anthropic, etc., via their provider ids as needed

Security/Storage:

- Prefer environment variables to store API keys; if `credentials.openaiApiKey` is present, treat it as a convenience fallback
- Do not log secrets

## Linear Label → CLI Routing

Add `labelAgentRouting` to `RepositoryConfig` with precedence over `labelPrompts`. When both exist:

- First pick the runner from `labelAgentRouting`
- Then compute prompt type/system prompt via `labelPrompts` (if Claude is selected)

If a non-Claude runner is selected, we still reuse the same prompt text builder (issue context + label template) to ensure consistent instructions across CLIs.

## Backwards Compatibility & Migration

- If no multi-CLI fields are present, behavior is identical to today (Claude-only).
- Existing config is migrated as-is; `model`/`fallbackModel` continue to apply to Claude.
- New settings are additive; repos can opt-in gradually.
- Config upgrades are performed by [`cyrus migrate-config`](docs/specs/upgrade-and-migration.md), which backs up the current file, adds missing multi-CLI keys, saves the result, and prints a diff summary without touching webhook or hosting values.

## Rollout Plan

Phase 0: Spec and scaffolding

- Add types and no-op defaults; wire defaults to Claude

Phase 1: Codex adapter (non-interactive)

- Spawn `codex exec` in repo worktrees; stream stdout lines to Linear
- Add `cyrus connect-openai`
- Add runner selection and repo/global defaults

Phase 2: OpenCode adapter

- Adapter against local HTTP API with `/session` + `/session/:id/command` and `/event` SSE
- Add optional `opencode.serverUrl` config
- Add `cyrus connect-openai` support to set OpenCode auth via API

Phase 3: Messaging polish

- Richer event mapping for OpenCode tools
- Optional Codex session resume support (`codex exec resume`)

## Risks & Open Questions

- Codex stdout is not an official API; output format may change. We mitigate by treating it as best-effort text streaming and posting a final summary on completion.
- OpenCode server availability: we rely on a local server URL; we’ll provide clear guidance and connection checks, and make the URL configurable.
- Tool gating parity: Claude has explicit tool/permission controls; Codex/OpenCode have different models. We’ll map Cyrus presets to Codex sandbox/approval policy and express intent in prompts for OpenCode.
- SSE robustness: implement retries for OpenCode event stream to handle temporary disconnects.

## References (from this repo)

- Current CLI app: `apps/cli/app.ts` (config load/save, setup wizard)
- Edge worker orchestrator: `packages/edge-worker/src/EdgeWorker.ts`
- Types: `packages/edge-worker/src/types.ts` (RepositoryConfig, EdgeWorkerConfig)
- Session manager: `packages/edge-worker/src/AgentSessionManager.ts`
- Claude runner: `packages/claude-runner` (adapts Claude SDK)

## Open Questions & Recommendations

1. Codex sandbox/approvals mapping
   - Question: How should Cyrus tool presets map to Codex `--sandbox` and `--approval-policy`?
   - Recommendation: readOnly → `--sandbox read-only` + `--approval-policy never`; safe → `--sandbox workspace-write` + `--approval-policy on-request`; all → `--sandbox danger-full-access` + `--approval-policy never`.

2. OpenCode provider default
   - Question: If a provider is not specified for OpenCode, which should we use?
   - Recommendation: Default to `provider=openai`; model resolved by repo → cliDefaults.opencode → fallback to prompt-only if missing.

3. OpenCode server URL
   - Question: What default server URL should we assume?
   - Recommendation: `http://localhost:17899` with a clear guidance message if unreachable; make it configurable via `cliDefaults.opencode.serverUrl`.

4. OpenAI API key storage
   - Question: Where should we store the user’s OpenAI API key (if they choose to persist it)?
   - Recommendation: Prefer environment variable. Optionally store under `credentials.openaiApiKey` in `~/.cyrus/config.json`. Never log. CLI can run `codex login --api-key` if available.

5. Linear posting cadence (non-Claude)
   - Question: Stream each line as a thought or batch?
   - Decision: Mirror current Claude cadence as closely as possible; if needed, coalesce to ~500–1000 char chunks to reduce noise.

6. Attachments in non-Claude prompts
   - Question: Should we embed file contents or references?
   - Decision: Reuse existing behavior. EdgeWorker already downloads attachments and appends a markdown manifest (titles, URLs, local paths) to the prompt, plus adds an attachments directory to allowed paths. Non‑Claude runners will receive the same manifest appended to their initial prompt.

7. Resume behavior for Codex/OpenCode
   - Question: Implement session resume in the first release?
   - Decision: Codex resume depends on CLI support for `codex exec resume` and surfacing conversation IDs. We will defer Codex resume until the CLI guarantees stable IDs. OpenCode resume is feasible now by reusing the OpenCode session id and POSTing additional `/session/:id/command` calls for subsequent prompts in the same Linear session.

8. Package layout for adapters
   - Question: New package vs. in-place within edge-worker?
   - Decision: Create `packages/agent-runner` from the start for clean boundaries.

9. Label routing precedence inside a repository
   - Question: How does `labelAgentRouting` interact with `labelPrompts` and repo/global runner defaults?
   - Recommendation: Determine repository (existing routing). Within that repo, `labelAgentRouting` selects runner+model first; if runner=claude, then `labelPrompts` selects prompt type.

10. Error messaging verbosity
   - Question: How verbose should guidance be in Linear thoughts on failures?
   - Recommendation: One or two actionable lines (install, link, set env) without stack traces.

11. OpenCode SSE event filtering
   - Question: Which field identifies the session in `/event` payloads?
   - Recommendation: Filter by `properties.sessionID`; fall back to defensive parsing and text aggregation if schema varies.

12. Default CLI when unspecified
   - Question: What is the global default CLI?
   - Decision: Default remains `claude` for backward compatibility. During initial setup, prompt the user to choose a default CLI and persist to `defaultCli`.

## External References

- OpenAI Codex CLI: https://github.com/openai/codex
  - Non-interactive mode: docs/getting-started.md#cli-usage, docs/advanced.md#non-interactive--ci-mode
  - Auth via API key: docs/authentication.md
  - Config & flags: docs/config.md
- OpenCode: https://github.com/sst/opencode
  - Server API: `packages/opencode/src/server/server.ts`
  - Auth model: `packages/opencode/src/auth/index.ts`
  - Prompt input model: `packages/opencode/src/session/prompt.ts`

---

Implementation Guides Index: see [docs/specs/README.md](specs/README.md) for phased, detailed instructions and acceptance criteria.

## Definition of Done

- Core goals, scope, and selection flow documented for Claude, Codex, and OpenCode.
- Config schema updates include runnable JSON examples and field parity with [docs/specs/phase-0-scaffold.md](specs/phase-0-scaffold.md).
- Runner abstraction, package layout, and adapter responsibilities align with [docs/specs/runner-interface.md](specs/runner-interface.md).
- Backwards compatibility plan references [docs/specs/upgrade-and-migration.md](specs/upgrade-and-migration.md) and reflects the migrate-config algorithm.
- Open questions resolved with actionable decisions for implementation teams.
