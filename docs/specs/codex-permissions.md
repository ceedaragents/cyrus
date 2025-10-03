# Codex Runner Permissions

## Goals

Align Codex runs launched by Cyrus with the security semantics we already expose for Claude Code:

- **readOnly** preset restricts Codex to inspection only.
- **safe** preset allows local edits inside the workspace with escalation for risky operations.
- **all** preset grants full automation for trusted repositories.

This keeps Linear issue routing, label prompts, and per-repo defaults consistent across runners.

## Mapping Strategy

Cyrus derives a permission profile for every session by examining the resolved tool preset:

| Resolved preset | Codex sandbox | Codex approval policy | `--full-auto` | Intended behaviour |
|-----------------|---------------|------------------------|----------------|--------------------|
| `readOnly` (no write/edit/Bash tools) | `read-only` | `never` | `false` | Inspection only; any write or network request fails immediately |
| `safe` (edits + curated git/gh commands) | `workspace-write` | `never` | `false` | Codex can edit files and run the approved git/gh workflow (status/diff/add/commit/push/merge/log/show/rev-parse/fetch/remote + `gh pr create/list/view/status`, `gh auth status`). Approvals are disabled so non-interactive sessions never stall. |
| `all` (includes Bash/git or explicit allow-all) | `danger-full-access` | `never` | `true` | Unrestricted automation suitable for trusted repos and the PR flow |

Fallbacks:

- If a preset cannot be inferred, Cyrus uses repo/global `cliDefaults.codex` values.
- Explicit overrides in routing rules or defaults still win; Cyrus only fills gaps.

The safe preset expands to the following Bash allowlist:

```
git status*
git diff*
git add*
git restore --staged*
git commit*
git log*
git show*
git branch*
git push*
git merge*
git rev-parse*
git fetch*
gh pr create*
gh pr list*
gh pr view*
gh pr status*
gh auth status*
```

(`*` indicates optional flags/arguments may follow the command prefix.)

## Runner Configuration

When starting a Codex session, EdgeWorker now passes the resolved profile to the adapter:

```ts
{
  type: "codex",
  cwd: workspacePath,
  prompt,
  model,
  sandbox,            // from profile or override
  approvalPolicy,     // from profile or override
  fullAuto,           // true only for "all"
  resumeSessionId?,
  env: withOpenAiApiKey
}
```

The adapter chooses the JSON streaming flag at runtime. It prefers `--experimental-json` (per upstream guidance) and falls back to `--json` if the binary does not recognise the newer flag, keeping compatibility with older Codex releases.

## Testing Notes

- Unit tests cover preset → profile mapping and the resulting command arguments.
- EdgeWorker integration tests assert read-only sessions never emit write actions, while `safe`/`all` sessions capture git-capable behaviour.
- Manual validation: run `readOnly` and `safe` label routes against a sample repo; confirm git commits succeed only under `safe`/`all`.

## Operational Guidance

- Operators can still tune `~/.codex/config.toml`; Cyrus derives sandbox/approval from tool presets first and falls back to repo/global `cliDefaults` only when it cannot infer a profile.
- To guarantee git access for follow-up sessions, route feature/PR labels to the `all` profile or set repository defaults accordingly.
- Leave Codex’s native sandbox enabled unless delegated to another isolation layer (e.g. dedicated VM).

## CLI Compatibility Notes

As of Codex CLI **0.42** (`codex-cli 0.42.0`), the non-interactive `codex exec` help output no longer lists `--sandbox` or `--approval-policy`. Running Cyrus with that release caused every Codex spawn to fail immediately with:

```
error: unexpected argument '--approval-policy' found
```

(Upstream issue: [openai/codex#4351](https://github.com/openai/codex/issues/4351))

To keep older CLIs working while we wait for official flag parity, the runner now:

- probes `codex exec --help` on startup to discover which options are available;
- uses `--experimental-json` or `--json` depending on the detected help text;
- only passes `--sandbox`/`--approval-policy` when the CLI supports them;
- falls back to `--full-auto` or `--dangerously-bypass-approvals-and-sandbox` (when present) to approximate `workspace-write` / `danger-full-access` behaviour; and
- logs a diagnostic message whenever we skip or substitute a flag so operators know why the command line changed.

For the best experience, upgrade Codex CLI once a release restores explicit sandbox/approval controls. Cyrus will automatically start using the richer flags again as soon as they reappear in the help output.
