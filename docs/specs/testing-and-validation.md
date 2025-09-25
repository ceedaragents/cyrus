# Testing & Validation

Manual Test Matrix

1) Baseline (Claude-only)
- No new fields in config → Start `cyrus` → existing flows work.

2) Config parsing
- Add `defaultCli: "codex"` and `cliDefaults.codex.model: "o3"` → Start `cyrus` → No crash.

3) Label routing to Codex (Phase 1)
- Repo has `labelAgentRouting: [{ labels: ["Codex"], runner: "codex", model: "o3" }]`.
- Create a Linear issue labeled `Codex` → Verify:
  - Worktree created
  - Thoughts stream containing Codex output
  - Final "Completed" summary

4) Missing Codex binary
- Remove codex from PATH → Verify thought instructing installation.

5) Missing OPENAI_API_KEY
- Unset env; run `cyrus connect-openai` → Verify key persisted and used.

6) Label routing to OpenCode (Phase 2)
- Set `cliDefaults.opencode.serverUrl` to a running server.
- Routing rule: runner=opencode, provider=openai, model=o4-mini.
- Create issue → Verify streaming thoughts via SSE.

7) OpenCode server unreachable
- Stop server → Verify guidance thought to start OpenCode and set serverUrl.

Acceptance Criteria per Phase

Phase 0
- Types compile.
- Old configs load.

Phase 1 (Codex)
- Label routes to Codex; stdout streamed to Linear.
- Helpful guidance for missing tools/keys.

Phase 2 (OpenCode)
- Label routes to OpenCode; SSE streaming works.
- Auth set via /auth/openai if possible; otherwise guidance.

Diagnostics
- Add `DEBUG_EDGE=true` to log runner selection and adapter spawn URLs/args (without secrets).
- Log selection: repo, labels, chosen runner, model/provider.

