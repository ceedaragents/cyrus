# Container Execution

Cyrus keeps the control plane on the host and supports two separate execution backends:

- `verification.mode = "ephemeral_container"` for one-shot verification runs
- `agentExecution.mode = "external_launcher"` for Codex sessions launched through an external sandbox backend such as `codex-api-kk`

This keeps Cyrus responsible for routing, prompting, session state, activity posting, and stop handling, while repository-specific execution happens somewhere else.

---

## Execution Model

### Ephemeral verification containers

Use `verification.mode = "ephemeral_container"` when you want the `verifications` subroutine to run in a temporary container:

1. Cyrus creates or reuses the issue worktree.
2. Cyrus runs `docker run --rm` with the worktree mounted in the verification image.
3. Cyrus captures `stdout`, `stderr`, exit code, and selected artifacts.
4. Cyrus feeds those results back into the normal `verifications` subroutine prompt.

This is useful when tests need the repository's own dev image, system packages, browsers, or other runtime dependencies that should not be installed into Cyrus itself.

### External launcher agent execution

Use `agentExecution.mode = "external_launcher"` when the main coding session should run through a separately managed backend:

1. Cyrus receives the issue, routes it, and creates the worktree.
2. Cyrus prepares a small host-side wrapper that `cd`s into the worktree and invokes the configured launcher command.
3. Cyrus starts Codex through that launcher.
4. Cyrus keeps the session state machine on the host and only publishes orchestrator-level events plus the final result.
5. The launcher/backend owns the sandbox lifecycle and cleanup.

Current behavior:

- This mode is intentionally `codex`-only.
- Cyrus still receives the normal `CodexRunner` result payloads.
- Raw Codex tool/thought event streams are not posted to the issue timeline in launcher-backed sessions.

---

## Requirements

### Docker or launcher backend access

`verification.mode = "ephemeral_container"` requires Cyrus to launch Docker containers directly.

`agentExecution.mode = "external_launcher"` requires a working launcher command on the host. In the current self-hosted prototype that is typically:

- launcher command: `~/bin/codex-api-kk`
- backend repo: `/Users/top/sail/cursor-sandbox`

### Host path mapping

If Cyrus itself runs in a container, Docker still needs host-visible paths when it mounts the repository/worktree into verification containers. Configure:

```json
{
  "hostPaths": {
    "repositoryPath": "/host/repos/my-app",
    "workspaceBaseDir": "/host/worktrees/my-app"
  }
}
```

Without `hostPaths`, Cyrus only knows its in-container paths and cannot mount the same worktree into child containers correctly.

### Auth and launcher environment

The launcher backend is responsible for its own sandbox auth/config state. Cyrus can still pass selected environment through:

```json
{
  "agentExecution": {
    "mode": "external_launcher",
    "runner": "codex",
    "command": "/Users/alice/bin/codex-api-kk",
    "args": ["--profile", "work"],
    "inheritEnv": ["OPENAI_API_KEY"],
    "env": {
      "NODE_ENV": "development"
    }
  }
}
```

---

## Repository Example

```json
{
  "id": "superbro",
  "name": "superbro",
  "repositoryPath": "/workspace/repos/superbro",
  "workspaceBaseDir": "/workspace/worktrees/superbro",
  "hostPaths": {
    "repositoryPath": "/host/repos/superbro",
    "workspaceBaseDir": "/host/worktrees/superbro"
  },
  "verification": {
    "mode": "ephemeral_container",
    "image": "ghcr.io/your-org/superbro-debug:latest",
    "workdir": "/workspace",
    "command": "pnpm install && pnpm test",
    "artifactGlobs": ["test-results/**", "playwright-report/**"]
  },
  "agentExecution": {
    "mode": "external_launcher",
    "runner": "codex",
    "command": "/Users/alice/bin/codex-api-kk",
    "inheritEnv": ["OPENAI_API_KEY"]
  }
}
```

---

## Security Notes

Granting Docker access to Cyrus is effectively privileged access to the runner machine. Treat this as a self-hosted runner feature, not a shared-production-host feature.

Recommended boundary:

- run Cyrus on a dedicated runner VM or machine
- do not give Cyrus access to business production containers
- prefer a Docker socket proxy or another narrow control layer over raw `docker.sock`
- keep the external launcher backend isolated from general-purpose application hosts

---

## F1 Validation

The current happy path is a launcher-backed Codex session in F1:

- launcher: `~/bin/codex-api-kk`
- report: [2026-03-22-codex-external-launcher-f1-drive.md](/Users/top/.codex/worktrees/1592/cyrus/apps/f1/test-drives/2026-03-22-codex-external-launcher-f1-drive.md)

Reference commands:

```bash
./apps/f1/f1 init-test-repo --path /tmp/f1-codex-external-launcher-<timestamp>

CYRUS_PORT=39019 \
CYRUS_REPO_PATH=/tmp/f1-codex-external-launcher-<timestamp> \
CYRUS_CODEX_LAUNCHER=/Users/top/bin/codex-api-kk \
node apps/f1/dist/server.js
```

This validates:

- issue worktree creation
- launcher-backed Codex execution
- orchestrator-only timeline visibility
- final response posting
- no lingering sandbox containers after completion

---

## Related Docs

- [CONFIG_FILE.md](/Users/top/.codex/worktrees/1592/cyrus/docs/CONFIG_FILE.md)
- [SELF_HOSTING.md](/Users/top/.codex/worktrees/1592/cyrus/docs/SELF_HOSTING.md)
- [SETUP_SCRIPTS.md](/Users/top/.codex/worktrees/1592/cyrus/docs/SETUP_SCRIPTS.md)
