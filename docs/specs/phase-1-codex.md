Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Adapter spawn args and env
- [x] Streaming + completion
- [x] Failure cases
- [x] Test plan
- [x] Ready for Implementation

# Phase 1: Codex Adapter

Objective: Enable running issues with OpenAI Codex CLI in non‑interactive mode, streaming output back to Linear as thoughts.

Prereqs
- Codex CLI installed (`pnpm i -g @openai/codex` or `brew install codex`).
- OPENAI_API_KEY available in env, or run one of the Codex auth flows below.

## Codex Authentication

Codex CLI supports two authentication paths:

- **OAuth login** – Run `codex login` on a trusted workstation. The CLI opens a browser for OAuth and stores the resulting tokens locally. Use this for developers who can interactively approve the login.
- **API key flow** – Run `cyrus connect-openai` (which writes your OpenAI key to Cyrus config and executes `codex login --api-key <key>`), or call `codex login --api-key <key>` directly when you already have an `OPENAI_API_KEY`. This is the preferred option for headless or CI/VPS environments where browser-based OAuth is not available.

The `cyrus validate` command runs a Codex health check (`codex exec --skip-git-repo-check --cd /tmp 'echo Codex health check'`) so operators can confirm the CLI is both installed and authenticated. Validation surfaces authentication failures (for example a 401 response) and exits non-zero if Codex auth is missing.

Acceptance Criteria
- A label can route an issue to Codex; the worker spawns `codex exec` in the worktree (selection precedence per [`docs/specs/edge-worker-integration.md`](edge-worker-integration.md)).
- Text output from Codex streams to the Linear agent session as thoughts.
- On completion, a final thought is posted.
- Claude path remains unaffected.
- Prompt includes the same attachment manifest used by Claude (append manifest + local paths as in [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md)).

Implementation Steps

1) RunnerFactory + CodexRunnerAdapter (new package or module)

- Create `packages/agent-runner/` (or equivalent module inside edge-worker for v1):
  - `CodexRunnerAdapter` using Node `child_process.spawn`.
  - Command:
    ```sh
    codex exec --cd <cwd> -m <model?> --approval-policy <...?> --sandbox <...?> "<prompt>"
    ```
  - Pipe `stdout` → `onEvent({ kind: 'text', text: line })`.
  - On `close` with code 0 → `onEvent({ kind: 'result', summary: 'Codex completed' })`.
  - On non-zero → `onEvent({ kind: 'error', error: new Error('codex exited '+code) })`.
  - Implement `stop()` by killing the spawned process.

2) Wire selection into EdgeWorker

- Follow docs/specs/edge-worker-integration.md to call RunnerFactory when selection.type === "codex".
- Use model/sandbox/approval policy from:
  - repo.runnerModels?.codex?.model → else config.cliDefaults?.codex?.model
  - config.cliDefaults?.codex?.sandbox and approvalPolicy if set

3) CLI additions (optional in Phase 1)

- `cyrus connect-openai`: prompt user for API key (hidden input) and either set `process.env.OPENAI_API_KEY` for the session or write to `config.credentials.openaiApiKey` (see [`docs/specs/cli-commands.md`](cli-commands.md)).
- Optionally run `codex login --api-key <key>` if `codex` is on PATH.

4) Failure handling

- If `codex` binary is missing (ENOENT): post a thought suggesting installation (`npm i -g @openai/codex` or `brew install codex`) and mark the run as failed without crashing EdgeWorker.
- If `OPENAI_API_KEY` is missing: post a thought guiding the user to run `cyrus connect-openai` or set the env variable before retrying.
- If Codex returns non-zero exit: include exit code plus suggestion to rerun locally with `DEBUG_EDGE=true` for more logs.

Sample Code (adapter skeleton)

```ts
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { Runner, RunnerConfig, RunnerEvent } from './types';

export class CodexRunnerAdapter implements Runner {
  private child?: ChildProcessWithoutNullStreams;
  constructor(private config: Extract<RunnerConfig, { type: 'codex' }>) {}

  async start(onEvent: (e: RunnerEvent) => void) {
    const args = ['exec', '--cd', this.config.cwd];
    if (this.config.model) { args.push('-m', this.config.model); }
    if (this.config.approvalPolicy) { args.push('--approval-policy', this.config.approvalPolicy); }
    if (this.config.sandbox) { args.push('--sandbox', this.config.sandbox); }
    args.push(this.config.prompt);

    try {
      this.child = spawn('codex', args, { env: process.env, cwd: this.config.cwd });
    } catch (err) {
      onEvent({ kind: 'error', error: err as Error });
      throw err;
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      chunk.split(/\r?\n/).forEach((line) => line && onEvent({ kind: 'text', text: line }));
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => onEvent({ kind: 'text', text: chunk }));
    this.child.on('close', (code) => {
      if (code === 0) onEvent({ kind: 'result', summary: 'Codex completed' });
      else onEvent({ kind: 'error', error: new Error(`codex exited ${code}`) });
    });

    return {};
  }

  async stop() {
    if (this.child && !this.child.killed) this.child.kill('SIGTERM');
  }
}
```

Manual Test Plan
- Add a test label (e.g., `Codex`) to `labelAgentRouting` mapping to runner=codex.
- Create a Linear issue with that label.
- Verify: worktree created; thoughts stream in Linear; final summary posted.
- Failure cases: remove codex from PATH, or unset OPENAI_API_KEY and validate helpful guidance.

## Notes on Resume
- Codex resume may require `codex exec resume` support in the installed version and a way to capture a conversation id. Defer implementing resume until this is stable (Phase 3 per [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md)).
- Capture stdout/stderr of resume attempts behind a feature flag so we can validate once Codex stabilizes IDs.

## Definition of Done

- RunnerFactory spawns Codex with args/env documented above and handles stdout/stderr streaming per [`docs/specs/runner-interface.md`](runner-interface.md).
- EdgeWorker posts attachment manifests and Linear thoughts identical to the Claude baseline.
- Error handling covers missing binary, missing credentials, and non-zero exit with actionable guidance.
- Manual tests exercise success and failure paths, including `cyrus connect-openai` integration.
