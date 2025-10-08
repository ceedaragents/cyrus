# Codex Runner Permissions

## Goals

Align Codex runs launched by Cyrus with the security semantics we already expose for Claude Code:

- **readOnly** preset restricts Codex to inspection only.
- **safe** preset allows write-oriented workflows with the curated git/gh toolset while now running unsandboxed.
- **all** preset grants full automation for trusted repositories and includes unrestricted Bash tooling.

This keeps Linear issue routing, label prompts, and per-repo defaults consistent across runners.

## Mapping Strategy

Cyrus derives a permission profile for every session by examining the resolved tool preset:

| Resolved preset | Codex sandbox | Codex approval policy | `--full-auto` | Intended behaviour |
|-----------------|---------------|------------------------|----------------|--------------------|
| `readOnly` (no write/edit/Bash tools) | `read-only` | `never` | `false` | Inspection only; any write or network request fails immediately |
| `safe` (edits + curated git/gh commands) | `danger-full-access` | `never` | `false` | Codex can edit files and run the approved git/gh workflow (status/diff/add/commit/push/merge/log/show/rev-parse/fetch/remote + `gh pr create/list/view/status`, `gh auth status`). Sessions start unsandboxed so git/gh works without extra flags; approvals remain disabled. |
| `all` (includes Bash/git or explicit allow-all) | `danger-full-access` | `never` | `false` | Same unsandboxed baseline but with unrestricted Bash support. Repositories must be explicitly trusted before routing to this preset. |

> **Security trade-off:** any write-enabled Codex session now runs unsandboxed (`danger-full-access`). This keeps git/gh workflows aligned with Claude’s behaviour but shifts isolation responsibility to the surrounding infrastructure and routing policies.

Fallbacks:

- If a preset cannot be inferred, Cyrus uses repo/global `cliDefaults.codex` values.
- Explicit overrides in routing rules or defaults still win; Cyrus only fills gaps.

The safe preset expands to the following Bash allowlist; with the sandbox disabled we rely on this curated list to keep commands predictable:

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
  fullAuto,           // remains false; exec mode already runs full-auto
  resumeSessionId?,
  env: withOpenAiApiKey
}
```

The adapter assumes modern Codex builds expose the stable `--json` stream flag and warns (once per process) if it is missing from `codex exec --help` output.

## Testing Notes

- Unit tests cover preset → profile mapping and the resulting command arguments.
- EdgeWorker integration tests assert read-only sessions never emit write actions, while `safe`/`all` sessions capture git-capable behaviour.
- Manual validation: run `readOnly` and `safe` label routes against a sample repo; confirm git commits succeed only under `safe`/`all`.

## Operational Guidance

- Operators can still tune `~/.codex/config.toml`; Cyrus derives sandbox/approval from tool presets first and falls back to repo/global `cliDefaults` only when it cannot infer a profile.
- To guarantee git access for follow-up sessions, route feature/PR labels to the `all` profile or set repository defaults accordingly.
- Codex’s native sandbox is now disabled for any write-enabled run; provide isolation through dedicated VMs or similar guardrails when necessary.

## CLI Compatibility Notes

As of Codex CLI **0.42** (`codex-cli 0.42.0`), the non-interactive `codex exec` help output no longer lists `--sandbox` or `--approval-policy`. Running Cyrus with that release caused every Codex spawn to fail immediately with:

```
error: unexpected argument '--approval-policy' found
```

(Upstream issue: [openai/codex#4351](https://github.com/openai/codex/issues/4351))

To keep older CLIs working while we wait for official flag parity, the runner now:

- probes `codex exec --help` on startup to discover which options are available;
- always requests `--json`, logging a diagnostic if the flag is absent from the help output;
- only passes `--sandbox`/`--approval-policy` when the CLI supports them;
- never falls back to the legacy `--dangerously-bypass-approvals-and-sandbox` flag, keeping behaviour aligned with the current Codex guidance;
- falls back to `--full-auto` when the CLI lacks sandbox toggles so write-enabled sessions can still edit files; and
- logs a diagnostic message whenever we skip or substitute a flag so operators know why the command line changed.

For the best experience, upgrade Codex CLI once a release restores explicit sandbox/approval controls. Cyrus will automatically start using the richer flags again as soon as they reappear in the help output.

## Stream Finalization

Earlier builds relied on a custom `___LAST_MESSAGE_MARKER___` token in the final assistant message to detect completion. The adapter now relies entirely on Codex’s JSONL metadata:

- When we receive `type: "item.completed"` with `item_type: "assistant_message"`, the adapter emits the `final` event immediately.
- Additional updates (`item.started`/`item.updated`) are treated as interim responses, and duplicate finals are ignored once the session has been marked complete.

The marker is no longer injected into prompts or required in Codex output.
