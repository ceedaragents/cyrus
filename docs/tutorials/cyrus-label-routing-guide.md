# Cyrus Multi-CLI & Label Routing Guide

This fork of Cyrus adds Codex JSON streaming, session persistence, and
label-driven routing so you can orchestrate multiple runners from a single
edge-worker deployment. This tutorial walks through the key workflows you need
as an operator.

## 1. Configuration Primer

The edge-worker reads `~/.cyrus/config.json`. Each `repository` entry can now
contain:

```json
{
  "labelAgentRouting": [
    { "labels": ["Codex"], "runner": "codex", "model": "o3" },
    { "labels": ["Bug"], "runner": "claude", "model": "claude-3.7-sonnet" }
  ],
  "labelPrompts": {
    "debugger": { "labels": ["Bug", "Regression"] },
    "builder": { "labels": ["Feature", "Improvement"] },
    "scoper": { "labels": ["PRD"] },
    "orchestrator": { "labels": ["Ops"], "allowedTools": "coordinator" }
  }
}
```

### Runner Routing

1. Fetch issue labels from Linear.
2. Walk `labelAgentRouting` (first match wins) → choose runner/model/provider.
3. If no label rule matches, fall back to the repo’s `runner` & `runnerModels`,
   then to global `cliDefaults`.
4. The selection is persisted so resumes/follow-ups reuse the same runner.

### Prompt Selection

After picking a runner, the edge-worker checks `labelPrompts` to decide which
system prompt template to load (`packages/edge-worker/prompts/*.md`). You can map
multiple labels to each template. If a non-Claude runner fires, the prompt text
still feeds into its instructions to keep behaviour consistent.

## 2. Migration & Setup Flow

1. **Bootstrap config** – run `pnpm --filter cyrus-ai build` followed by
   `pnpm --filter cyrus-ai start` (post-build copies `dist/apps/cli/app.js` to
   `dist/app.js`, so the standard `cyrus` bin works out of the box).
2. **Connect OpenAI (optional)** – `cyrus connect-openai` to store the API key for
   Codex.
3. **Update repos** – use `cyrus add-repository` or edit `~/.cyrus/config.json`
   directly to add `labelAgentRouting` / `labelPrompts`.
4. **Process helper** – run `./scripts/edge-process-helper.sh` to list or kill
   stale edge-worker/ngrok processes (uses `pgrep`; install `procps` on Linux if
   missing).
5. **Restart edge-worker** – `cyrus start` or whichever supervisor you use; watch
   logs for `Runner selection resolved` and `Using <prompt> system prompt`.

## 3. Verifying the Pipeline

- `pnpm --filter cyrus-agent-runner test:run` – unit tests for Codex/Claude adapters (normalized thought/action/final events only).
- `pnpm --filter cyrus-edge-worker test:run` – includes regression harness
  (`EdgeWorker.codex-integration.test.ts`) that mocks Linear and asserts thoughts,
  finals, and 🛠️ action cards when routing Codex sessions.
- Builds: `pnpm --filter cyrus-agent-runner build`, `pnpm --filter cyrus-edge-worker build`, `pnpm --filter cyrus-ai build`.

## 4. Operational Tips

- **Label Routing Precedence** – order matters. Place high-priority labels at the
  top of `labelAgentRouting`.
- **Prompt Overlaps** – you can map the same label to multiple prompts, but the
  first template in the check order (debugger → builder → scoper → orchestrator)
  wins. The edge-worker logs which prompt is chosen.
- **Session Persistence** – non-Claude sessions (Codex) survive worker
  restarts; the edge-worker reloads `sessionRunnerSelections` and continues
  streaming events when Linear triggers follow-ups.
- **Action Logging** – every `action` event becomes a 🛠️ card in Linear with the
  command details to keep audit history.
- **Process Cleanup** – if you hit ngrok’s 1-agent cap, use
  `./scripts/edge-process-helper.sh --kill <PID>` to gracefully terminate stale
  tunnels.

## 5. Suggested Defaults

Run (to seed default routing labels):

```
cyrus labels init-default-routing
```

This will create the following label rules per repo unless they already exist:

- `codex`, `cli-codex` → Codex runner
- `claude`, `cli-claude` → Claude runner

You can still set repo-specific models or rely on global defaults.

## 6. Next Steps

- Use `docs/specs/prompt-label-management.md` for the upcoming CLI enhancements
  that expose prompt editing commands.
- Keep `docs/agents.md` updated with any shared operational procedures (process
  helper, new commands, etc.).

With these pieces in place you can manage multi-runner workflows, keep prompts
aligned with labels, and ensure Codex sessions behave identically to the
Claude integration.
