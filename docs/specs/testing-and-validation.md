Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Baseline (Claude-only)
- [x] Codex routing success/failure
- [x] OpenCode routing success/failure
- [x] Connectivity/diagnostics
- [x] Ready for Implementation

# Testing & Validation

Manual Test Matrix

1) Baseline (Claude-only)
- Ensure config omits multi-CLI keys.
- Command: `DEBUG_EDGE=true cyrus --issue <id>`.
- Expectation: Claude flow unchanged; logs show `runner=claude` selection.

2) Config parsing sanity
- Add `defaultCli: "codex"` and `cliDefaults.codex.model: "o3"` to config.
- Command: `cyrus validate` followed by `cyrus --issue <id>` without Codex routing.
- Expectation: CLI starts without crash; validation reports missing codex binary if absent.

3) Codex routing success
- Repo config: `labelAgentRouting: [{ labels: ["Codex"], runner: "codex", model: "o3" }]`.
- Command: create Linear issue with label `Codex`, trigger agent run.
- Expectation: Worktree created; Linear thoughts stream Codex stdout; final summary posted.

4) Codex failure cases
- Remove Codex from PATH (`mv $(which codex) ...` temporarily).
- Trigger same run.
- Expectation: Linear thought instructs installation; EdgeWorker logs show `codex binary missing` warning.
- Reset PATH afterwards.

5) Missing OPENAI_API_KEY recovery
- Unset env; run `cyrus connect-openai --non-interactive --api-key <key>`.
- Rerun Codex-labeled issue.
- Expectation: Thought acknowledges key configured; run succeeds.

6) OpenCode routing success
- OpenCode validation steps deferred; consult opencode guidelines when adapter work resumes.
- Create Linear issue with matching label.
- Expectation: Linear thoughts stream SSE content; `DEBUG_EDGE` logs show session id reuse map creation.

7) OpenCode resume reuse
- After first OpenCode run, send follow-up prompt in same Linear agent session.
- Expectation: Adapter reuses cached session id; logs show `resume=true` and SSE events continue.

8) OpenCode server unreachable
- Stop the server; rerun issue.
- Expectation: Linear thought instructs starting OpenCode and verifying `serverUrl`.

Acceptance Criteria per Phase

**Phase 0**
- Typecheck: `pnpm --filter edge-worker test -- --watch=false` (or equivalent) succeeds.
- `cyrus` loads legacy configs without warnings.

**Phase 1 (Codex)**
- Label routes to Codex; stdout streamed to Linear with minimal latency.
- Guidance covers missing binaries/keys with actionable steps.

**Phase 2 (OpenCode)**
- Label routes to OpenCode; SSE streaming works and message text extracted from `MessageV2`.
- Auth seeded via `PUT /auth/openai` when key available; otherwise guidance thought posted.
- Resume via session id reuse confirmed.

Diagnostics & Instrumentation
- Run with `DEBUG_EDGE=true` to log runner selection (`repo`, `labels`, `runner`, `model`, `provider`).
- Codex adapter logs spawn command, approval policy, and sandbox (no secrets).
- OpenCode adapter logs `serverUrl`, `sessionID`, retry attempts, and SSE reconnect notices.
- Capture Ansi-free summaries for posting to Linear while leaving detailed logs in stdout.

## Definition of Done

- Manual matrix covers baseline, Codex success/failure, OpenCode success/failure, and resume scenarios.
- Debug guidance specifies exact commands (`cyrus`, `validate`, `connect-openai`) and expected log lines.
- Phase acceptance criteria align with [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md) milestones.
- Diagnostics logging requirements inform adapter implementations in [`docs/specs/runner-interface.md`](runner-interface.md) and EdgeWorker wiring.
