Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Command list + semantics
- [x] Flags + examples
- [x] Headless notes
- [x] Ready for Implementation

# CLI Additions (apps/cli)

Define CLI ergonomics needed to support the multi-CLI rollout in [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md). All commands live in `apps/cli/app.ts` and reuse the existing `loadEdgeConfig`/`saveEdgeConfig` helpers.

## Commands

### connect-openai
- Purpose: Help users persist or inject `OPENAI_API_KEY`, then sync it with Codex.
- Behavior:
  - Prompt for API key using hidden input when not supplied via `--api-key`.
  - Save the key to `~/.cyrus/config.json` under `credentials.openaiApiKey` unless already set and `--force` is omitted.
  - Remind users that environment variables override stored credentials for safety.
  - If `codex` is on PATH, run `codex login --api-key <key>` and surface non-zero exit guidance instead of throwing.
  - Headless mode: support `--non-interactive --api-key <key>` to bypass prompts and exit non-zero when the flag is missing.

### set-default-cli <claude|codex>
- Update `defaultCli` in config and save.
- When run interactively, confirm the change and remind about repo-level overrides.
- Headless mode: accept `--non-interactive` (no prompts) to keep VPS workflows deterministic.
- Also called from the initial setup wizard if `defaultCli` is missing (see [`docs/specs/phase-0-scaffold.md`](phase-0-scaffold.md)).

### set-default-model <cli> <model>
- Update `cliDefaults[cli].model`.
- Suggest per-repo overrides when the active repository already defines `runnerModels`.

### migrate-config [--non-interactive|--interactive] [--backup-dir <path>]
- Non-destructive config upgrade aligned with [`docs/specs/upgrade-and-migration.md`](upgrade-and-migration.md).
- Algorithm:
  1. Choose backup target (default `~/.cyrus/backup/config.<timestamp>.json`; override via `--backup-dir`).
  2. Copy current config to the backup path.
  3. Merge missing keys: `defaultCli` (default `claude`), `cliDefaults`, `credentials`, repo-level `runner`, `runnerModels`, and `labelAgentRouting` (initialize empty containers only).
  4. Save the updated config preserving unknown fields and formatting.
  5. Generate a diff summary (keys added, values left untouched) and print to stdout.
- Headless defaults to `--non-interactive`; prompts appear only when `--interactive` is provided.

### validate
- Read-only health check after upgrades.
- Steps:
  - Test Linear proxy connectivity using existing tokens; report latency and status.
  - If any repo or default selects Codex, run `codex --version` and warn if unavailable.
  - OpenCode health checks deferred alongside the adapter (see opencode guidelines when re-enabled).
  - Exit non-zero when any check fails; never modify config files.

## Flags & Examples

```bash
cyrus connect-openai --non-interactive --api-key "$OPENAI_API_KEY"
cyrus set-default-cli codex --non-interactive
cyrus set-default-model codex o3
cyrus migrate-config --backup-dir ~/.cyrus/backups
cyrus validate
```

## Initial Setup Wizard Touchpoints
- On first run (no `defaultCli` in config), prompt the user to choose `claude` or `codex` before repository linking.
- Reuse the `set-default-cli` logic to persist the choice and echo next steps (e.g., `cyrus connect-openai`).

## Definition of Done

- Command semantics reflect multi-CLI requirements and reference supporting specs where relevant.
- Headless-friendly flags (`--non-interactive`, `--api-key`, `--backup-dir`) exist for automation scenarios.
- migrate-config follows the backup → merge → save → diff workflow without overwriting existing values.
- validate performs read-only connectivity checks and reports actionable errors without mutating config state.
