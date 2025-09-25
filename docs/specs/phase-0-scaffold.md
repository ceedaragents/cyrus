Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] New fields (global + repo)
- [x] No-op defaults and migration stance
- [x] Initial setup prompt for defaultCli
- [x] Ready for Implementation

# Phase 0: Scaffold (Types, Config, Defaults)

Objective: Add types and config support for multi‑CLI without changing runtime behavior (still Claude only). Align field names with [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md) and ensure CLI/Edge worker types stay in sync.

Acceptance Criteria
- New fields compile in both apps/cli and edge-worker packages.
- Existing configs continue to load unchanged.
- If new fields are omitted, behavior is unchanged.
- Initial setup wizard prompts for a global default CLI and saves `defaultCli`.

Changes

1) Update Edge app config type in apps/cli/app.ts:EdgeConfig

- Add optional global defaults and credentials.

```ts
// apps/cli/app.ts
interface EdgeConfig {
  repositories: RepositoryConfig[];
  ngrokAuthToken?: string;
  stripeCustomerId?: string;
  defaultModel?: string;           // existing (Claude)
  defaultFallbackModel?: string;   // existing (Claude)

  // NEW: multi-CLI
  defaultCli?: "claude" | "codex" | "opencode";
  cliDefaults?: {
    claude?: { model?: string; fallbackModel?: string };
    codex?: { model?: string; approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never"; sandbox?: "read-only" | "workspace-write" | "danger-full-access" };
    opencode?: { provider?: string; model?: string; serverUrl?: string };
  };
  credentials?: { openaiApiKey?: string };
}
```

2) Update repository config type in packages/edge-worker/src/types.ts

Add optional runner selection and label-based routing (pure types; no behavior yet).

```ts
// packages/edge-worker/src/types.ts
export interface RepositoryConfig {
  // ...existing fields...

  // NEW: default runner for this repo
  runner?: "claude" | "codex" | "opencode";
  // NEW: per-runner model overrides
  runnerModels?: {
    claude?: { model?: string; fallbackModel?: string };
    codex?: { model?: string };
    opencode?: { provider?: string; model?: string };
  };
  // NEW: label-based CLI routing
  labelAgentRouting?: Array<{
    labels: string[];
    runner: "claude" | "codex" | "opencode";
    model?: string;
    provider?: string; // opencode
  }>;
}

export interface EdgeWorkerConfig {
  // ...existing fields...

  // NEW: global defaults
  defaultCli?: "claude" | "codex" | "opencode";
  cliDefaults?: {
    claude?: { model?: string; fallbackModel?: string };
    codex?: { model?: string; approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never"; sandbox?: "read-only" | "workspace-write" | "danger-full-access" };
    opencode?: { provider?: string; model?: string; serverUrl?: string };
  };
  credentials?: { openaiApiKey?: string };
}
```

3) Config migration and defaults

- No migration required; new fields are optional additions.
- For now, EdgeApp continues to read/write the same `~/.cyrus/config.json` file.
- When saving config, preserve unknown fields.
- If `defaultCli` is missing on first run, show a one-time prompt in the CLI to pick `claude`, `codex`, or `opencode` and persist it (matches setup guidance in [`docs/specs/cli-commands.md`](cli-commands.md)).

4) Do not change runtime model selection yet

- Keep using existing Claude fields (`defaultModel`, `defaultFallbackModel`, repo-level `model`/`fallbackModel`).
- Phase 1 will actually read `defaultCli` et al.

Testing
- Build both packages to ensure types compile.
- Run `cyrus` in a repo with the old config and ensure startup is unchanged.
- Manually add the new fields to `~/.cyrus/config.json` and confirm no behavior change.

## Definition of Done

- EdgeConfig and RepositoryConfig typings match the schemas documented in [`docs/multi-cli-runner-spec.md`](../multi-cli-runner-spec.md).
- CLI setup wizard prompts for `defaultCli` on first run and persists the choice without affecting existing configs.
- Migration stance stays no-op and references [`docs/specs/upgrade-and-migration.md`](upgrade-and-migration.md) for future steps.
- Manual testing covers both legacy configs and configs containing the new multi-CLI fields.
