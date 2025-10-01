# Prompt & Label Management Spec

## Background

Operators need hands-on control over how Linear labels map to agent prompts and
runner selections. Today the configuration lives inside `~/.cyrus/config.json`
and is edited manually. We want first-class CLI support so users can inspect,
create, update, or delete these mappings safely, and bootstrap sensible global
defaults for CLI routing.

## Goals

1. List existing label→prompt associations and the prompt assets backing them.
2. Edit label lists for any prompt template (built-in or custom).
3. Scaffold entirely new prompt templates (name + markdown body) and tie labels
   to them.
4. Delete custom templates and detach their labels.
5. Provide a helper command to seed global label routing so well-known labels
   (`codex`, `cli-codex`, `claude`, `cli-claude`, `opencode`, `cli-opencode`) map
   to the matching runner without specifying models.

## Non-Goals

- Changing the underlying prompt text for the four built-in templates (debugger,
  builder, scoper, orchestrator).
- Altering how prompts are rendered inside the edge-worker beyond wiring in the
  data edits performed by the CLI.
- Managing team-specific Linear label creation (still done in Linear).

## Proposed CLI Surface

All commands live under `cyrus prompts` for prompt management and `cyrus labels`
for routing helpers.

### Prompt Commands

| Command | Description |
| --- | --- |
| `cyrus prompts list [--repo <id>] [--json]` | Show each prompt template, the labels bound to it, file path, version tag (if present), and tool overrides. |
| `cyrus prompts edit <prompt> --labels <list>` | Replace the label list for an existing template. Works for built-ins and customs; validates duplicates. |
| `cyrus prompts create <name> --labels <list> [--from template\|file]` | Generate a new prompt markdown (`prompts/<name>.md`), optionally copy from a built-in or external file, and register it. |
| `cyrus prompts delete <name>` | Remove a custom prompt mapping + markdown file after confirmation. Built-ins rejected. |

Flags:
- `--repo <id>` (apply to single repository)
- `--all` (apply to every repo entry)
- `--dry-run`
- `--json` structured output

Safety:
- Auto-backup config (`config.json.YYYYMMDDHHmm`) before writes.
- Confirm destructive actions unless `--yes` supplied.
- Warn when the same label appears in multiple prompt mappings.

### Routing Helper

`cyrus labels init-default-routing [--repo <id>] [--force]`

- Seeds (or replaces if `--force`) each target repository’s `labelAgentRouting`
  with three rules: codex/cli-codex → Codex, opencode/cli-opencode → OpenCode,
  claude/cli-claude → Claude.
- Leaves `model`/`provider` empty so runner defaults apply.
- No changes when rules already match unless `--force`.

## Data Model Touch Points

- `RepositoryConfig.labelPrompts` (existing) – update label arrays or
  insert/delete entries.
- `packages/edge-worker/prompts/*.md` – new custom templates stored alongside
  built-ins.
- `RepositoryConfig.labelAgentRouting` – seeded by the helper command.

## Implementation Notes

- CLI edits should reuse the same JSON loader/writer edge-worker already uses to
  avoid schema drift.
- When creating templates, ensure filesystem paths are sanitized (kebab-case) and
  update TypeScript types if we support arbitrary names (export union updates).
- After config writes, prompt the operator to restart the edge-worker (or send a
  reload signal if we add one later).
- Add unit tests covering CLI command parsing plus edge-worker integration tests
  to confirm a custom prompt file is picked up during session start.

## Telemetry / Logging

- CLI should print human-readable summaries and support `--json` for automation.
- EdgeWorker already logs `Runner selection` and `Using X system prompt` – ensure
  new commands don’t silence that.

## Open Questions

- Should custom prompts support tool overrides (`allowedTools` /
  `disallowedTools`)? Assume yes; CLI scaffolder should accept optional flags.
- Do we need per-repo vs global prompt definitions? For now, manipulate repo
  configs individually; future work could add shared templates.

## Handoff Prompt for Implementation

```
You are continuing the "Prompt & Label Management" feature for Cyrus.

Deliverables:
1. Implement the CLI commands described in docs/specs/prompt-label-management.md.
2. Ensure edits update ~/.cyrus/config.json safely with backups.
3. Scaffold custom prompt markdown files alongside existing prompts.
4. Add unit/integration tests validating CLI command behavior and edge-worker consumption.
5. Update docs/tutorials/cyrus-label-routing-guide.md and docs/agents.md if CLI flags or flows change.

Constraints:
- TypeScript project (NodeNext). Existing packages use pnpm.
- Favor minimal dependencies; reuse existing config helpers.
- Keep formatting/ASCII rules from repository guidelines.

Before coding, read docs/specs/prompt-label-management.md to understand context.
Run pnpm --filter cyrus-agent-runner test:run and pnpm --filter cyrus-edge-worker test:run after changes.
```
