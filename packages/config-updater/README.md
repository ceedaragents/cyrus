# cyrus-config-updater

Configuration update handlers for Cyrus. This package provides utilities for managing Cyrus configuration files, environment variables, repositories, and MCP server configurations.

## Installation

```bash
pnpm add cyrus-config-updater
```

## Usage

### ConfigUpdater Class (Recommended)

The `ConfigUpdater` class provides a high-level API for all configuration operations:

```typescript
import { ConfigUpdater } from "cyrus-config-updater";

const updater = new ConfigUpdater("~/.cyrus");

// Update main configuration
await updater.updateConfig({
  repositories: [
    {
      id: "repo-1",
      name: "my-repo",
      repositoryPath: "/path/to/repo",
      baseBranch: "main",
    },
  ],
});

// Update environment variables
await updater.updateEnv({
  ANTHROPIC_API_KEY: "sk-...",
  backupEnv: true,
});

// Clone a repository
await updater.updateRepository({
  repository_url: "https://github.com/user/repo.git",
  repository_name: "repo",
});

// Configure MCP servers
await updater.configureMcp({
  mcpServers: {
    "linear": {
      command: "npx",
      args: ["-y", "@linear/mcp-server-linear"],
      env: {
        LINEAR_API_KEY: "${LINEAR_API_KEY}",
      },
      transport: "stdio",
    },
  },
});

// Read current configuration
const config = updater.readConfig();
```

### Individual Handlers (Advanced)

You can also use individual handlers directly:

```typescript
import {
  handleCyrusConfig,
  handleCyrusEnv,
  handleRepository,
  handleConfigureMcp,
  handleTestMcp,
} from "cyrus-config-updater";

const cyrusHome = "~/.cyrus";

// Use handlers directly
const result = await handleCyrusConfig(payload, cyrusHome);
```

## API

### ConfigUpdater

#### Constructor

```typescript
new ConfigUpdater(cyrusHome: string)
```

Creates a new ConfigUpdater instance.

- `cyrusHome` - Path to the Cyrus home directory (typically `~/.cyrus`)

#### Methods

##### `updateConfig(payload: CyrusConfigPayload): Promise<ApiResponse>`

Updates the main Cyrus configuration file (`config.json`).

##### `updateEnv(payload: CyrusEnvPayload): Promise<ApiResponse>`

Updates Cyrus environment variables (`.env` file). Merges with existing variables.

##### `updateRepository(payload: RepositoryPayload): Promise<ApiResponse>`

Clones or verifies a Git repository. Idempotent - safe to call multiple times.

##### `testMcp(payload: TestMcpPayload): Promise<ApiResponse>`

Tests an MCP server connection. (Note: Currently a placeholder implementation)

##### `configureMcp(payload: ConfigureMcpPayload): Promise<ApiResponse>`

Writes MCP server configuration files (`mcp-{slug}.json`). Performs environment variable substitution.

##### `applyConfig(config?, env?, mcp?): Promise<ApiResponse[]>`

Applies multiple configuration updates in sequence. Returns an array of responses.

##### `readConfig(): any`

Reads the current Cyrus configuration.

## Response Format

All methods return an `ApiResponse`:

```typescript
// Success response
{
  success: true,
  message: "Operation completed successfully",
  data?: any  // Optional additional data
}

// Error response
{
  success: false,
  error: "Error message",
  details?: string  // Optional error details
}
```

## Handler Features

### Config Handler (`handleCyrusConfig`)

- Validates all required fields
- Merges optional settings
- Creates dated backups (optional)
- Atomically writes `config.json`

### Env Handler (`handleCyrusEnv`)

- Merges with existing variables (doesn't overwrite all)
- Filters control keys (`restartCyrus`, `backupEnv`, `variables`)
- Creates dated backups (optional)
- Uses `KEY=VALUE` format

### Repository Handler (`handleRepository`)

- Idempotent (safe to call multiple times)
- Extracts repo name from URL if not provided
- Clones to `~/.cyrus/repos/{name}`
- Verifies `.git` directory exists

### MCP Test Handler (`handleTestMcp`)

- Validates transport type (`stdio` or `sse`)
- Validates transport-specific requirements
- Currently returns placeholder response

### MCP Configure Handler (`handleConfigureMcp`)

- Writes one file per MCP server
- Performs `${VAR_NAME}` environment variable substitution
- Files: `~/.cyrus/mcp-{slug}.json`

## Type Definitions

See [types.ts](./src/types.ts) for complete type definitions.

Key types:
- `CyrusConfigPayload` - Repository configurations and global settings
- `CyrusEnvPayload` - Environment variables
- `RepositoryPayload` - Git repository details
- `TestMcpPayload` - MCP server connection test params
- `ConfigureMcpPayload` - MCP server configurations
- `McpServerConfig` - Individual MCP server config
- `ApiResponse` - Union of `SuccessResponse` and `ErrorResponse`

## License

MIT
