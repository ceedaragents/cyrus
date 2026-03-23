# Cyrus Configuration File

Cyrus stores configuration in `~/.cyrus/config.json`. This file is created automatically during initial setup and can be edited manually to customize behavior.

Editing this manually only applies to those running the fully end-to-end self-hosted. Those who are paying for Cyrus, management of config.json is automated.

---

## Repository Configuration

Each repository in the `repositories` array can have these properties:

### `allowedTools` (array of strings)

Controls which tools Claude can use when processing issues. Default: all standard tools plus `Bash(git:*)` and `Bash(gh:*)`.

Examples:

- `["Read(**)", "Edit(**)", "Bash(git:*)", "Task"]` - Allow reading, editing, git commands, and task management
- `["Read(**)", "Edit(**)", "Bash(npm:*)", "WebSearch"]` - Allow reading, editing, npm commands, and web search
- `["Read(**)", "Edit(**)", "mcp__github"]` - Allow all tools from the GitHub MCP server
- `["Read(**)", "Edit(**)", "mcp__github__search_repositories"]` - Allow only the search_repositories tool from GitHub MCP

For security configuration details, see: https://code.claude.com/docs/en/settings#permission-settings

### `mcpConfigPath` (string or array of strings)

Path(s) to MCP (Model Context Protocol) configuration files. MCP allows Claude to access external tools and data sources like databases or APIs.

Can be specified as:

- A single string: `"mcpConfigPath": "/home/user/myapp/mcp-config.json"`
- An array of strings: `"mcpConfigPath": ["/home/user/myapp/mcp-base.json", "/home/user/myapp/mcp-local.json"]`

When multiple files are provided, configurations are composed together. Later files override earlier ones for the same server names.

Expected file format:

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "command-to-run",
      "args": ["arg1", "arg2"]
    }
  }
}
```

Learn more about MCP: https://code.claude.com/docs/en/mcp

### `hostPaths` (object)

Optional host-visible paths for repositories that need to launch verification containers from inside Cyrus.

Use this when Cyrus itself runs in a container and the verification container must mount the same worktree using a host path instead of Cyrus's in-container path.

For the full execution model, runner support, and security boundaries, see [CONTAINER_EXECUTION.md](/Users/top/.codex/worktrees/1592/cyrus/docs/CONTAINER_EXECUTION.md).

Properties:

- `repositoryPath` - Host path for the repository root
- `workspaceBaseDir` - Host path for the directory that contains issue worktrees

Example:

```json
{
  "hostPaths": {
    "repositoryPath": "/host/repos/my-app",
    "workspaceBaseDir": "/host/worktrees/my-app"
  }
}
```

### `verification` (object)

Configures how the `verifications` subroutine should execute for this repository.

**Local verification (default behavior):**

```json
{
  "verification": {
    "mode": "local"
  }
}
```

**Ephemeral container verification:**

```json
{
  "verification": {
    "mode": "ephemeral_container",
    "image": "ghcr.io/your-org/project-debug:latest",
    "command": "pnpm install && pnpm test",
    "workdir": "/workspace",
    "shell": "bash",
    "timeoutSec": 1800,
    "artifactGlobs": ["test-results/**", "playwright-report/**"]
  }
}
```

When `mode` is `ephemeral_container`, Cyrus runs the verification command in a temporary `docker run --rm` container, captures stdout/stderr/exit code, and then feeds those results into the normal `verifications` subroutine prompt instead of asking the agent to rerun the commands locally.

Use this when tests need repository-specific system dependencies, browsers, language toolchains, or build images that should not be installed into the long-running Cyrus process.

### `agentExecution` (object)

Configures how the main coding agent should execute for this repository.

**Local agent execution (default behavior):**

```json
{
  "agentExecution": {
    "mode": "local"
  }
}
```

**External launcher execution:**

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

When `mode` is `external_launcher`, Cyrus still owns routing, prompts, session state, and activity posting, but it launches Codex through an external backend command such as `codex-api-kk`.

- This mode is intentionally `codex`-only in the current prototype.
- `command` should point at the launcher entrypoint on the Cyrus host, for example `~/bin/codex-api-kk`.
- `args`, `inheritEnv`, and `env` let you thread profile selection or auth-related environment variables into that launcher without moving the Cyrus control plane into the sandbox itself.

Operational notes:

- `verification.mode = "ephemeral_container"` is still the place for Dockerized verification runs.
- `external_launcher` assumes the launcher/backend is already responsible for sandbox lifecycle, auth state, and cleanup.
- Granting Docker access to the launcher backend is effectively privileged access to the runner machine. Use a dedicated runner and prefer a narrow Docker proxy or helper where possible.

### `teamKeys` (array of strings)

Routes Linear issues from specific teams to this repository. When specified, only issues from matching teams trigger Cyrus.

Example: `["CEE", "FRONT", "BACK"]` - Only process issues from teams CEE, FRONT, and BACK

### `projectKeys` (array of strings)

Routes Linear issues from specific projects to this repository. When specified, only issues belonging to the listed Linear projects will be processed by this repository.

Example: `["Mobile App", "Web Platform", "API Service"]` - Only process issues that belong to these Linear projects

Note: This is useful when you want to separate work by project rather than by team, especially in organizations where multiple projects span across teams.

### `routingLabels` (array of strings)

Routes Linear issues with specific labels to this repository. This is useful when you have multiple repositories handling issues from the same Linear team but want to route based on labels (e.g., "backend" vs "frontend" labels).

Example: `["backend", "api"]` - Only process issues that have the "backend" or "api" label

---

## Routing Priority Order

When multiple routing configurations are present, Cyrus evaluates them in the following priority order:

1. **`routingLabels`** (highest priority) - Label-based routing
2. **`projectKeys`** (medium priority) - Project-based routing
3. **`teamKeys`** (lowest priority) - Team-based routing

If an issue matches multiple routing configurations, the highest priority match will be used. For example, if an issue has a label that matches `routingLabels` and also belongs to a project in `projectKeys`, the label-based routing will take precedence.

---

## Label-Based AI Modes

### `labelPrompts` (object)

Routes issues to different AI modes based on Linear labels and optionally configures allowed tools per mode.

**Simple format (labels only):**

```json
{
  "debugger": ["Bug"],
  "builder": ["Feature", "Improvement"],
  "scoper": ["PRD"]
}
```

**Advanced format (with dynamic tool configuration):**

```json
{
  "debugger": {
    "labels": ["Bug"],
    "allowedTools": "readOnly"
  },
  "builder": {
    "labels": ["Feature", "Improvement"],
    "allowedTools": "safe"
  },
  "scoper": {
    "labels": ["PRD"],
    "allowedTools": ["Read(**)", "WebFetch", "mcp__linear"]
  }
}
```

**Modes:**

- **debugger**: Systematic problem investigation mode
- **builder**: Feature implementation mode
- **scoper**: Requirements analysis mode

**Tool Presets:**

- **`"readOnly"`**: Only tools that read/view content (9 tools)
   - `Read(**)`, `WebFetch`, `WebSearch`, `TodoRead`, `TodoWrite`, `NotebookRead`, `Task`, `Batch`, `Skill`

- **`"safe"`**: All tools except Bash (11 tools)
   - All readOnly tools plus: `Edit(**)`, `NotebookEdit`

- **`"all"`**: All available tools including Bash (12 tools)
   - All safe tools plus: `Bash`

- **Custom array**: Specify exact tools needed, e.g., `["Read(**)", "Edit(**)", "Task"]`

Note: Linear MCP tools (`mcp__linear`) are always included automatically. Slack MCP tools (`mcp__slack`) are included when the `SLACK_BOT_TOKEN` environment variable is set (Linear and Slack sessions only; excluded from GitHub sessions).

---

## User Access Control

Control which Linear users can delegate issues to Cyrus. Supports both global configuration and per-repository overrides.

### `userAccessControl` (object)

Can be configured at the global level or per-repository.

**Properties:**

- **`allowedUsers`** (array) - Users allowed to delegate issues. If specified, ONLY these users can trigger sessions. Omit to allow everyone.
- **`blockedUsers`** (array) - Users blocked from delegating issues. Takes precedence over allowedUsers.
- **`blockBehavior`** (string) - What happens when a blocked user tries to delegate:
  - `"silent"` (default) - Ignore the webhook quietly
  - `"comment"` - Post a message explaining the user is not authorized
- **`blockMessage`** (string) - Custom message when blockBehavior is "comment". Supports template variables:
  - `{{userName}}` - The user's display name
  - `{{userId}}` - The user's Linear ID

  Default: `"{{userName}}, you are not authorized to delegate issues to this agent."`

**User Identifiers:**

Users can be specified in three formats:
- String (treated as Linear user ID): `"usr_abc123"`
- Object with ID: `{ "id": "usr_abc123" }`
- Object with email: `{ "email": "user@example.com" }` (case-insensitive)

**Example - Global configuration:**

```json
{
  "userAccessControl": {
    "blockedUsers": ["usr_known_bad_actor"],
    "blockBehavior": "comment",
    "blockMessage": "{{userName}}, please contact your team lead to use this agent."
  },
  "repositories": [...]
}
```

**Example - Per-repository configuration:**

```json
{
  "repositories": [{
    "id": "main-app",
    "name": "Main Application",
    "userAccessControl": {
      "allowedUsers": [
        "usr_senior_dev_1",
        { "email": "lead@company.com" },
        { "id": "usr_senior_dev_2" }
      ],
      "blockBehavior": "comment"
    }
  }]
}
```

**Inheritance Rules:**

- **allowedUsers**: Repository config OVERRIDES global (not merged)
- **blockedUsers**: Repository config EXTENDS global (merged/additive)
- **blockBehavior**: Repository config OVERRIDES global
- **blockMessage**: Repository config OVERRIDES global

---

## Global Configuration

In addition to repository-specific settings, you can configure global defaults:

### `promptDefaults` (object)

Sets default allowed tools for each prompt type across all repositories. Repository-specific configurations override these defaults.

```json
{
  "promptDefaults": {
    "debugger": {
      "allowedTools": "readOnly"
    },
    "builder": {
      "allowedTools": "safe"
    },
    "scoper": {
      "allowedTools": ["Read(**)", "WebFetch", "mcp__linear"]
    }
  }
}
```

### `global_setup_script` (string)

Path to a script that runs for all repositories when creating new worktrees. See the main README for details on setup scripts.

---

## Tool Configuration Priority

When determining allowed tools, Cyrus follows this priority order:

1. Repository-specific prompt configuration (`labelPrompts.debugger.allowedTools`)
2. Global prompt defaults (`promptDefaults.debugger.allowedTools`)
3. Repository-level allowed tools (`allowedTools`)
4. Global default allowed tools
5. Safe tools fallback (all tools except Bash)

---

## Example Configuration

```json
{
  "promptDefaults": {
    "debugger": {
      "allowedTools": "readOnly"
    },
    "builder": {
      "allowedTools": "safe"
    }
  },
  "repositories": [{
    "id": "workspace-123456",
    "name": "my-app",
    "repositoryPath": "/path/to/repo",
    "hostPaths": {
      "repositoryPath": "/host/repos/my-app",
      "workspaceBaseDir": "/host/worktrees/my-app"
    },
    "allowedTools": ["Read(**)", "Edit(**)", "Bash(git:*)", "Bash(gh:*)", "Task"],
    "mcpConfigPath": "./mcp-config.json",
    "teamKeys": ["BACKEND"],
    "projectKeys": ["API Service", "Backend Infrastructure"],
    "routingLabels": ["backend", "api", "infrastructure"],
    "verification": {
      "mode": "ephemeral_container",
      "image": "ghcr.io/your-org/my-app-debug:latest",
      "command": "pnpm install && pnpm test",
      "workdir": "/workspace",
      "artifactGlobs": ["test-results/**"]
    },
    "agentExecution": {
      "mode": "external_launcher",
      "runner": "codex",
      "command": "/Users/alice/bin/codex-api-kk",
      "inheritEnv": ["OPENAI_API_KEY"]
    },
    "labelPrompts": {
      "debugger": {
        "labels": ["Bug", "Hotfix"],
        "allowedTools": "all"
      },
      "builder": {
        "labels": ["Feature"]
      },
      "scoper": {
        "labels": ["RFC", "Design"]
      }
    }
  }]
}
```

---

## Core Repository Fields

Each repository configuration includes these required fields:

- `id` - Unique identifier for the repository
- `name` - Repository name
- `repositoryPath` - Absolute path to the repository on disk
- `baseBranch` - Default branch for the repository (e.g., "main")
- `workspaceBaseDir` - Directory for git worktrees
- `isActive` - Whether the repository is active
- `linearWorkspaceId` - Linear workspace UUID (references a key in `linearWorkspaces`)

These fields are managed automatically during setup. For self-hosted instances, use the `cyrus self-auth` and `cyrus self-add-repo` commands.
