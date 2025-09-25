Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Non-destructive migration
- [x] Headless-friendly behavior
- [x] Validation + rollback
- [ ] Ready for Implementation

## Upgrade & Migration Plan (Existing Setups)

Goal: Let existing users upgrade Cyrus and adopt the multi‑CLI config without breaking current hosting (VPS, Cloudflare worker, reverse proxy, webhooks).

Principles
- Non‑destructive: never overwrite existing keys; add only missing fields.
- Opt‑in: new features off by default; `defaultCli` stays `claude` unless the user changes it.
- Headless‑friendly: avoid interactive prompts on servers unless requested.
- No webhook churn: keep `PROXY_URL`, `CYRUS_BASE_URL`, and server port unchanged.

High‑level Flow
1) Backup current config
- Copy `~/.cyrus/config.json` to `~/.cyrus/backup/config.<timestamp>.json`.

2) Add missing fields only
- If `defaultCli` is missing, set to `"claude"` (no prompt in headless mode).
- Add empty `cliDefaults` and `credentials` objects if missing.
- Do not change `repositories[]` other than adding optional fields when absent.

3) Preserve hosting variables
- Never change `PROXY_URL`, `CYRUS_BASE_URL`, `CYRUS_SERVER_PORT`, `CYRUS_HOST_EXTERNAL`.
- Never modify `.env` files; read-only.

4) Validate connectivity (optional but recommended)
- Test proxy connectivity (token handshake) without altering webhook registrations.
- Report status succinctly: Connected/Disconnected + reason.

5) Rollback plan
- If anything looks wrong, restore from the backup file and rerun previous Cyrus version if needed.

### `cyrus migrate-config` Algorithm
1. Determine backup location (`~/.cyrus/backup/config.<timestamp>.json` by default, override via `--backup-dir`).
2. Copy existing config to the backup path.
3. Merge missing keys: `defaultCli`, `cliDefaults`, `credentials`, and repo-level `runner`, `runnerModels`, `labelAgentRouting` (initialize empty values only).
4. Persist config with formatting preserved and no deletions.
5. Produce a diff summary (lists keys added; confirms zero removals) for CLI output.
6. Exit non-zero on write errors but keep the backup file intact.

CLI Commands

1) migrate-config
- Purpose: Non-interactive schema migration and backup for existing configs.
- Implements the algorithm above and integrates with [`docs/specs/cli-commands.md`](cli-commands.md).
- Flags:
  - `--non-interactive` (default) — do not prompt; set `defaultCli=claude` when missing.
  - `--interactive` — prompt to choose `defaultCli` and optionally set per-CLI defaults.
  - `--backup-dir <path>` — override backup location.

2) validate
- Purpose: Sanity check after upgrade; does NOT modify state.
- Checks:
  - Proxy connectivity (uses configured `PROXY_URL`).
  - Ability to start local server on `CYRUS_SERVER_PORT` (no webhook registration).
  - Reports repositories discovered and token validity (read-only checks already present in EdgeWorker startup).

3) check-webhooks (optional)
- Purpose: Dry-run the webhook handling path using the existing proxy; does not re-register webhooks.
- Behavior: Open an NDJSON connection and confirm events receive; times out gracefully.

Headless/Server Guidance (VPS + Cloudflare)
- Upgrade steps:
  1. Update Cyrus: `npm i -g cyrus-ai@latest` (or your package flow).
  2. Run `cyrus migrate-config --non-interactive` (backs up config automatically).
  3. Run `cyrus validate` to confirm connectivity.
  4. Start Cyrus with your existing env file: `cyrus --env-file=/path/to/.env`.
- Ensure your `.env` keeps your Cloudflare proxy values (do not change them):
  - `PROXY_URL=https://your-cloudflare-worker.yourdomain.workers.dev`
  - `CYRUS_BASE_URL=https://your-public-url` (if applicable)
  - `CYRUS_HOST_EXTERNAL=true` (if applicable)
  - `CYRUS_SERVER_PORT=3456` (or your choice)
- Emphasize “no webhook churn”: neither `migrate-config` nor `validate` touches webhook registrations—existing Cloudflare worker endpoints remain unchanged.

What this WILL NOT do
- It will not re‑register webhooks or change webhook endpoints.
- It will not alter your Cloudflare worker or DNS.
- It will not change existing repository routes.

User Choices after Upgrade
- If you want to adopt multi‑CLI later: run `cyrus set-default-cli codex` (or `opencode`) and update per‑repo routing as needed.
- To link OpenAI: run `cyrus connect-openai` (optional; leaves Cloudflare setup untouched).

Troubleshooting
- If `validate` reports proxy disconnected:
  - Confirm `PROXY_URL` points to your worker and the worker is live.
  - Re-run Cyrus with `DEBUG_EDGE=true` for detailed logs.
- If webhooks stop arriving:
  - Verify your Cloudflare worker still forwards to the same path and that `CYRUS_BASE_URL` hasn’t changed.

## Definition of Done

- Migration algorithm and CLI guidance stay in sync with [`docs/specs/cli-commands.md`](cli-commands.md).
- Upgrade steps remain non-destructive, headless-friendly, and reiterate “no webhook churn”.
- Troubleshooting covers proxy validation and rollback using the generated backups.
- References align with [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md) for config compatibility.
