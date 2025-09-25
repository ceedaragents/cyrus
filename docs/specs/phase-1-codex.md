# Phase 1: Codex Adapter

Objective: Enable running issues with OpenAI Codex CLI in non‑interactive mode, streaming output back to Linear as thoughts.

Prereqs
- Codex CLI installed (`npm i -g @openai/codex` or `brew install codex`).
- OPENAI_API_KEY available in env, or run `codex login --api-key`.

Acceptance Criteria
- A label can route an issue to Codex; the worker spawns `codex exec` in the worktree.
- Text output from Codex streams to the Linear agent session as thoughts.
- On completion, a final thought is posted.
- Claude path remains unaffected.
- Prompt includes the same attachment manifest used by Claude.

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

- `cyrus connect-openai`: prompt user for API key and either set `process.env.OPENAI_API_KEY` for the session or write to config.credentials.openaiApiKey.
- Optionally run `codex login --api-key <key>` if `codex` is on PATH.

4) Failure handling

- If `codex` binary is missing (ENOENT): post a thought suggesting installation.
- If OPENAI_API_KEY is missing: post a thought suggesting `cyrus connect-openai` or setting env var.

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

Notes on Resume
- Codex resume may require `codex exec resume` support in the installed version and a way to capture a conversation id. Defer implementing resume until this is stable.
