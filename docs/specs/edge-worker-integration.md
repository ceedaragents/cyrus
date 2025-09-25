# EdgeWorker Integration Plan

Goal: Wire runner selection + adapters into EdgeWorker while preserving Claude behavior.

Acceptance Criteria
- Label-based routing can select a runner (Claude, Codex, OpenCode).
- Claude path remains unchanged when Claude is selected.
- Non-Claude path posts text chunks and a final summary to the Linear agent session.
- Attachment manifest appended to prompts for both Claude and non‑Claude runners.

New Utilities

1) Runner selection

```ts
// packages/edge-worker/src/EdgeWorker.ts (private helper)
private resolveRunnerSelection(labels: string[], repo: RepositoryConfig): {
  type: "claude" | "codex" | "opencode";
  model?: string;
  provider?: string; // for opencode
} {
  // 1) labelAgentRouting
  for (const rule of repo.labelAgentRouting ?? []) {
    if (rule.labels.some((l) => labels.includes(l))) {
      return { type: rule.runner, model: rule.model, provider: rule.provider };
    }
  }
  // 2) repo default
  if (repo.runner) {
    const rm = repo.runnerModels ?? {};
    if (repo.runner === "opencode") return { type: "opencode", model: rm.opencode?.model, provider: rm.opencode?.provider };
    if (repo.runner === "codex") return { type: "codex", model: rm.codex?.model };
    return { type: "claude", model: rm.claude?.model };
  }
  // 3) global defaults (from this.config)
  const d = this.config.defaultCli ?? "claude";
  const cd = this.config.cliDefaults ?? {} as any;
  if (d === "opencode") return { type: "opencode", model: cd.opencode?.model, provider: cd.opencode?.provider };
  if (d === "codex") return { type: "codex", model: cd.codex?.model };
  return { type: "claude", model: cd.claude?.model };
}
```

2) Runner factory invocation

Replace direct `new ClaudeRunner(...)` with:

```ts
const selection = this.resolveRunnerSelection(labels, repository);
if (selection.type === "claude") {
  // current path (unchanged)
  const runnerConfig = this.buildClaudeRunnerConfig(/* existing args */);
  const runner = new ClaudeRunner(runnerConfig);
  agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner);
  await runner.startStreaming(prompt);
} else {
  // new path (non-Claude)
  await this.startNonClaudeRunner({ selection, cwd: workspace.path, prompt, repo: repository, linearAgentActivitySessionId });
}
```

3) Non-Claude runner streaming bridge

```ts
// packages/edge-worker/src/EdgeWorker.ts (private helper)
private async startNonClaudeRunner(opts: {
  selection: { type: "codex" | "opencode"; model?: string; provider?: string };
  cwd: string;
  prompt: string;
  repo: RepositoryConfig;
  linearAgentActivitySessionId: string;
}) {
  const { selection, cwd, prompt, repo, linearAgentActivitySessionId } = opts;

  // Post an initial thought (we already do this elsewhere; ensure it’s called)
  await this.postInstantAcknowledgment(linearAgentActivitySessionId, repo.id);

  // Create adapter (pseudo-code; implemented in Phase 1/2)
  const runner = RunnerFactory.create({
    type: selection.type,
    cwd,
    prompt,
    ...(selection.type === "codex" ? { model: selection.model, sandbox: this.config.cliDefaults?.codex?.sandbox, approvalPolicy: this.config.cliDefaults?.codex?.approvalPolicy } : {}),
    ...(selection.type === "opencode" ? { model: selection.model, provider: selection.provider, serverUrl: this.config.cliDefaults?.opencode?.serverUrl } : {}),
  });

  // Stream events to Linear as thoughts (mirror Claude cadence; coalesce if needed)
  await runner.start((e) => {
    if (e.kind === "text" && e.text?.trim()) {
      this.postThought(linearAgentActivitySessionId, repo.id, e.text).catch(() => {});
    } else if (e.kind === "error") {
      this.postThought(linearAgentActivitySessionId, repo.id, `Error: ${e.error.message}`).catch(() => {});
    } else if (e.kind === "result") {
      this.postThought(linearAgentActivitySessionId, repo.id, e.summary ?? "Completed").catch(() => {});
    }
  });
}
```

4) Helper to post a thought (reuse existing patterns)

EdgeWorker already posts thoughts via `createAgentActivity({ content: { type: "thought", body }})` in several places. Extract a small helper:

```ts
private async postThought(sessionId: string, repositoryId: string, body: string) {
  const linearClient = this.linearClients.get(repositoryId);
  if (!linearClient) return;
  await linearClient.createAgentActivity({ agentSessionId: sessionId, content: { type: "thought", body } });
}
```

Safety & Fallbacks
- If RunnerFactory is not available or adapter errors immediately, post a failure thought and exit that session path without crashing the worker.
- Keep child/parent session logic Claude-only for now.
- For OpenCode, cache the server session id keyed by Linear agent session id to allow “resume” (follow‑up prompts continue the same OpenCode session).

Testing
- Force selection.type to "codex" in a test branch and verify thoughts appear.
- Force selection.type to "claude" and ensure unchanged behavior.
