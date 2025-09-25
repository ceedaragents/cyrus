# CLI Additions (apps/cli)

Commands

1) connect-openai
- Purpose: Help user set OPENAI_API_KEY and (optionally) log in Codex and OpenCode.
- Location: `apps/cli/app.ts`, extend command parsing.
- Behavior:
  - Prompt for API key (hidden input) if not present in env.
  - Save to `~/.cyrus/config.json` under `credentials.openaiApiKey`.
  - If `codex` is on PATH, run `codex login --api-key <key>`.
  - If `cliDefaults.opencode.serverUrl` is set, `PUT /auth/openai` with `{ type: 'api', key }`.

2) set-default-cli <claude|codex|opencode>
- Update `defaultCli` in config and save.
 - Also available in the initial setup wizard if `defaultCli` is missing.

3) set-default-model <cli> <model>
- Update `cliDefaults[cli].model`.
- For `opencode`, also allow `--provider <id>`.

4) migrate-config [--non-interactive|--interactive] [--backup-dir <path>]
- Non‑destructive config upgrade for existing users.
- Adds only missing keys; backs up previous file; prints diff summary.

5) validate
- Checks proxy connectivity and local server viability without changing state.
- Useful after an upgrade.

Implementation notes
- Use existing `loadEdgeConfig()` / `saveEdgeConfig()` helpers.
- For prompts, reuse the readline wrapper in app.ts.
- For codex login, spawn `codex` and ignore non-zero exit (just show guidance).

Examples

```bash
cyrus connect-openai
cyrus set-default-cli codex
cyrus set-default-model codex o3
cyrus set-default-model opencode o4-mini --provider openai
```

Initial Setup Wizard
- On first run (no `defaultCli` in config), prompt:
  - “Choose your default CLI (claude/codex/opencode): ”
  - Persist `defaultCli` after selection.
  - Then proceed to repository linking.
```
