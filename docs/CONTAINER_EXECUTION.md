# Container Execution

Cyrus can keep its control plane on the host while moving repository work into Docker containers. There are two separate execution modes:

- `verification.mode = "ephemeral_container"` for one-shot verification runs
- `agentExecution.mode = "persistent_issue_container"` for one long-lived issue container that hosts the runner process

This keeps Cyrus responsible for routing, prompting, session state, activity posting, and stop handling, while the repository-specific build/debug environment lives in containers.

---

## Execution Model

### Ephemeral verification containers

Use `verification.mode = "ephemeral_container"` when you want the `verifications` subroutine to run in a temporary container:

1. Cyrus creates or reuses the issue worktree.
2. Cyrus runs `docker run --rm` with the worktree mounted in the verification image.
3. Cyrus captures `stdout`, `stderr`, exit code, and selected artifacts.
4. Cyrus feeds those results back into the normal `verifications` subroutine prompt.

This is useful when tests need the repository's own dev image, system packages, browsers, or other runtime dependencies that should not be installed into Cyrus itself.

### Persistent issue containers

Use `agentExecution.mode = "persistent_issue_container"` when the main coding session should execute inside a long-lived issue container:

1. Cyrus receives the issue, routes it, and creates the worktree.
2. Cyrus starts one Docker container for that issue.
3. Cyrus launches the selected runner inside that container.
4. Cyrus keeps the session state machine on the host and streams activities back to Linear/F1.
5. Cyrus destroys the issue container when the session finishes or is stopped.

Current runner behavior:

- `codex`, `cursor`, and `gemini` run through `docker exec` wrappers.
- `claude` runs through a bridge process inside the issue container so the Claude Agent SDK query loop executes in-container without moving the Cyrus orchestration layer.

---

## Requirements

### Docker access

Cyrus must be able to launch containers. In practice that means one of:

- direct access to the Docker daemon
- a restricted Docker socket proxy
- a host-side helper service that only allows approved container launches

### Host path mapping

If Cyrus itself runs in a container, Docker still needs host-visible paths when it mounts the repository/worktree into child containers. Configure:

```json
{
  "hostPaths": {
    "repositoryPath": "/host/repos/my-app",
    "workspaceBaseDir": "/host/worktrees/my-app"
  }
}
```

Without `hostPaths`, Cyrus only knows its in-container paths and cannot mount the same worktree into child containers correctly.

### Auth and tool state inside issue containers

Some runners need auth/config state that normally lives on the host, for example `~/.codex`. Use:

- `mountPaths` to mount additional host directories into the issue container at the same absolute paths
- `inheritEnv` to pass selected host environment variables through
- `env` to force container-specific variables such as `CODEX_HOME`

Example:

```json
{
  "agentExecution": {
    "mode": "persistent_issue_container",
    "image": "ghcr.io/your-org/project-dev:latest",
    "mountPaths": ["/Users/alice/.codex"],
    "inheritEnv": ["OPENAI_API_KEY"],
    "env": {
      "CODEX_HOME": "/Users/alice/.codex"
    },
    "supportedRunners": ["codex", "claude"]
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
    "mode": "persistent_issue_container",
    "image": "ghcr.io/your-org/superbro-dev:latest",
    "mountPaths": ["/Users/alice/.codex"],
    "inheritEnv": ["OPENAI_API_KEY"],
    "env": {
      "CODEX_HOME": "/Users/alice/.codex"
    },
    "supportedRunners": ["claude", "codex"]
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
- keep issue containers unprivileged and only mount the directories they need

---

## F1 Validation

The Codex path has been validated end-to-end in F1 with a dedicated image:

- image: `cyrus-f1-codex-test:local`
- report: [2026-03-18-agent-execution-codex-f1-drive.md](/Users/top/.codex/worktrees/1592/cyrus/apps/f1/test-drives/2026-03-18-agent-execution-codex-f1-drive.md)

Reference commands:

```bash
./apps/f1/f1 init-test-repo --path /tmp/f1-agent-execution-codex-<timestamp>

CYRUS_PORT=39019 \
CYRUS_REPO_PATH=/tmp/f1-agent-execution-codex-<timestamp> \
CYRUS_AGENT_EXECUTION_IMAGE=cyrus-f1-codex-test:local \
CYRUS_AGENT_EXECUTION_RUNNERS=codex \
node apps/f1/dist/server.js
```

This validates:

- issue worktree creation
- persistent issue container startup
- Codex execution inside the issue container
- subroutine resume across the same container
- final response posting
- container cleanup on completion

---

## Related Docs

- [CONFIG_FILE.md](/Users/top/.codex/worktrees/1592/cyrus/docs/CONFIG_FILE.md)
- [SELF_HOSTING.md](/Users/top/.codex/worktrees/1592/cyrus/docs/SELF_HOSTING.md)
- [SETUP_SCRIPTS.md](/Users/top/.codex/worktrees/1592/cyrus/docs/SETUP_SCRIPTS.md)
