# MCP (Model Context Protocol) Handler

This document describes the TypeScript implementation of the MCP configuration and testing handlers, ported from the Go update-server.

## Overview

The MCP handler manages MCP server configurations and connection testing, including:
- Writing individual MCP config files (`~/.cyrus/mcp-{slug}.json`)
- Validating slug names for security
- Testing MCP server connectivity (placeholder implementation)
- Supporting multiple transport types (stdio, sse, http)

## Files

- `/Users/agentops/code/cyrus-workspaces/CYPACK-185/packages/config-server/src/handlers/mcp-handler.ts` - Main implementation
- `/Users/agentops/code/cyrus-workspaces/CYPACK-185/packages/config-server/src/handlers/mcp-handler.test.ts` - Comprehensive tests (23 test cases)

## API

### `handleConfigureMCP(payload: ConfigureMCPPayload, cyrusHome: string): Promise<string[]>`

Configures MCP servers by writing individual config files.

**Important**: This function ONLY writes individual MCP config files. It does NOT modify `config.json` - that is handled by `handleCyrusConfig`.

#### Parameters

- `payload: ConfigureMCPPayload` - The MCP configuration payload containing:
  - `mcpServers: Record<string, MCPServerConfig>` - Map of slug to MCP server config
    - Key: Server slug (alphanumeric, hyphens, underscores only)
    - Value: MCP server configuration object

- `cyrusHome: string` - Path to the Cyrus home directory (e.g., `~/.cyrus`)

#### Returns

- `Promise<string[]>` - Array of file paths that were written

#### Throws

- Error if no servers provided
- Error if slug validation fails
- Error if file write fails

#### Example Usage

```typescript
import { handleConfigureMCP } from './handlers/mcp-handler';

// Configure Linear MCP server
const payload = {
  mcpServers: {
    'linear': {
      command: 'npx',
      args: ['-y', '@linear/mcp-server-linear'],
      env: {
        LINEAR_API_KEY: 'lin_api_xxx'
      }
    },
    'github': {
      command: 'npx',
      args: ['-y', '@github/mcp-server-github'],
      env: {
        GITHUB_TOKEN: 'ghp_xxx'
      }
    }
  }
};

const filesWritten = await handleConfigureMCP(payload, '/home/user/.cyrus');
console.log('Files written:', filesWritten);
// Output: ['/home/user/.cyrus/mcp-linear.json', '/home/user/.cyrus/mcp-github.json']
```

#### MCP Server Config Structure

Each MCP server config can have the following fields:

```typescript
interface MCPServerConfig {
  // For stdio transport
  command?: string;        // Command to execute (e.g., 'npx', 'node')
  args?: string[];         // Command arguments
  env?: Record<string, string>; // Environment variables

  // For http/sse transport
  url?: string;            // Server URL
  transport?: 'stdio' | 'sse' | 'http'; // Transport type
  headers?: Record<string, string>;     // HTTP headers
}
```

#### File Output Format

Each config file is written as:

```json
{
  "mcpServers": {
    "slug": {
      "command": "npx",
      "args": ["-y", "@linear/mcp-server-linear"],
      "env": {
        "LINEAR_API_KEY": "lin_api_xxx"
      }
    }
  }
}
```

This wrapping structure allows the files to be used directly by Claude Code's MCP configuration system.

### `deleteMCPConfigFile(slug: string, cyrusHome: string): Promise<void>`

Deletes an individual MCP config file.

#### Parameters

- `slug: string` - The MCP server slug
- `cyrusHome: string` - Path to the Cyrus home directory

#### Example Usage

```typescript
import { deleteMCPConfigFile } from './handlers/mcp-handler';

await deleteMCPConfigFile('linear', '/home/user/.cyrus');
// Deletes /home/user/.cyrus/mcp-linear.json
```

### `handleTestMCP(payload: TestMCPPayload): Promise<TestMCPResponse>`

Tests MCP server connectivity before configuration.

**Note**: This is currently a placeholder implementation. Full MCP testing requires the `@modelcontextprotocol/sdk` package which is not currently installed.

#### Parameters

- `payload: TestMCPPayload` - The test configuration containing:
  - `transportType: 'stdio' | 'sse' | 'http'` - Transport type (required)
  - `command?: string` - Command for stdio transport
  - `commandArgs?: Array<{value: string, order: number}>` - Ordered command arguments
  - `serverUrl?: string` - Server URL for http/sse transport
  - `headers?: Array<{name: string, value: string}>` - HTTP headers
  - `envVars?: Array<{key: string, value: string}>` - Environment variables

#### Returns

- `Promise<TestMCPResponse>` - Test response containing:
  - `success: boolean` - Whether the test succeeded
  - `server_info?: {name: string, version: string}` - Server information
  - `tools?: Array<{name: string, description?: string}>` - Available tools
  - `error?: string` - Error message if test failed

#### Example Usage

```typescript
import { handleTestMCP } from './handlers/mcp-handler';

// Test stdio MCP server
const testPayload = {
  transportType: 'stdio',
  command: 'npx',
  commandArgs: [
    { value: '-y', order: 0 },
    { value: '@linear/mcp-server-linear', order: 1 }
  ],
  envVars: [
    { key: 'LINEAR_API_KEY', value: 'lin_api_xxx' }
  ]
};

const result = await handleTestMCP(testPayload);
console.log('Test result:', result);
```

## Slug Validation

MCP server slugs must follow strict validation rules to prevent security issues:

- **Allowed**: Alphanumeric characters (a-z, A-Z, 0-9), hyphens (-), underscores (_)
- **Not allowed**: Special characters, spaces, dots, path separators, etc.
- **Empty slugs**: Not allowed

### Valid Slugs
- `linear`
- `github`
- `my-custom-server`
- `server_123`
- `MyServer-v2`

### Invalid Slugs
- `../../../etc/passwd` (path traversal)
- `server/name` (contains slash)
- `server.name` (contains dot)
- `server name` (contains space)
- `` (empty)

## File Permissions

- MCP config files: `0644` (read/write for owner, read for group and others)
- Cyrus home directory: `0755` (created if doesn't exist)

## Transport Types

### 1. stdio Transport

Used for command-line MCP servers that communicate via stdin/stdout.

```typescript
{
  transportType: 'stdio',
  command: 'npx',
  commandArgs: [
    { value: '-y', order: 0 },
    { value: '@linear/mcp-server-linear', order: 1 }
  ],
  envVars: [
    { key: 'LINEAR_API_KEY', value: 'your_key' }
  ]
}
```

**Required fields**: `command`

### 2. SSE (Server-Sent Events) Transport

Used for MCP servers that use server-sent events over HTTP.

```typescript
{
  transportType: 'sse',
  serverUrl: 'https://example.com/mcp',
  headers: [
    { name: 'Authorization', value: 'Bearer token123' }
  ]
}
```

**Required fields**: `serverUrl`

### 3. HTTP Transport

Used for MCP servers that use standard HTTP requests.

```typescript
{
  transportType: 'http',
  serverUrl: 'https://example.com/mcp',
  headers: [
    { name: 'X-API-Key', value: 'key123' }
  ]
}
```

**Required fields**: `serverUrl`

## Testing

The implementation includes 23 comprehensive tests covering:

### handleConfigureMCP Tests
- Writing individual MCP config files
- Creating directories that don't exist
- Handling transport and URL configs
- Error handling for no servers provided
- Slug validation (empty, invalid characters, path traversal)
- Valid slugs with hyphens and underscores
- Overwriting existing configs

### deleteMCPConfigFile Tests
- Deleting existing files
- Handling non-existent files (no error)

### handleTestMCP Tests
- Valid stdio/sse/http transport configurations
- Invalid transport type errors
- Missing required fields (command, serverUrl)
- Command args with proper ordering
- Empty headers/envVars arrays

### Integration Tests
- Configure and delete workflow
- Multiple servers in sequence

Run tests with:
```bash
cd packages/config-server
pnpm test:run -- mcp-handler.test.ts
```

## Enabling Full MCP Testing

The `handleTestMCP` function is currently a placeholder. To enable full MCP testing:

### 1. Install the MCP SDK

```bash
cd packages/config-server
pnpm add @modelcontextprotocol/sdk
```

### 2. Implement Transport Creation

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const client = new Client({
  name: 'cyrus-config-server',
  version: '1.0.0',
}, {
  capabilities: {}
});
```

### 3. Connect and List Tools

```typescript
await client.connect(transport);
const toolsList = await client.listTools();
const tools = toolsList.tools.map(tool => ({
  name: tool.name,
  description: tool.description
}));
```

See the implementation notes in the source code for more details.

## Integration with Express

Example Express route for MCP configuration:

```typescript
import { handleConfigureMCP, handleTestMCP } from './handlers/mcp-handler';

// Configure MCP servers
app.post('/api/mcp/configure', async (req, res) => {
  try {
    const payload = req.body as ConfigureMCPPayload;
    const cyrusHome = process.env.CYRUS_HOME || join(os.homedir(), '.cyrus');

    const filesWritten = await handleConfigureMCP(payload, cyrusHome);

    res.json({
      success: true,
      message: 'MCP files written successfully',
      mcpFilesWritten: filesWritten,
      configUpdated: false, // This endpoint does NOT modify config.json
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test MCP connection
app.post('/api/mcp/test', async (req, res) => {
  try {
    const payload = req.body as TestMCPPayload;
    const result = await handleTestMCP(payload);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
```

## Differences from Go Implementation

1. **User/Ownership Management**: The TypeScript version does not set file ownership (no `chown` equivalent)
2. **MCP SDK**: The Go version uses `github.com/modelcontextprotocol/go-sdk/mcp`, TypeScript version has a placeholder until SDK is installed
3. **Transport Creation**: The Go version creates transports directly, TypeScript version needs implementation when SDK is available
4. **Error Handling**: TypeScript uses native Error objects instead of Go's error wrapping

## Security Considerations

1. **Slug Validation**: Prevents path traversal attacks by validating slug names
2. **File Paths**: All file paths are constructed safely using `path.join()`
3. **Directory Creation**: Creates directories with secure permissions (0755)
4. **File Permissions**: Sets appropriate permissions (0644) on config files
5. **Input Validation**: Validates all required fields and transport configurations

## Common Use Cases

### 1. Configure Linear MCP Server

```typescript
await handleConfigureMCP({
  mcpServers: {
    linear: {
      command: 'npx',
      args: ['-y', '@linear/mcp-server-linear'],
      env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY }
    }
  }
}, cyrusHome);
```

### 2. Configure Multiple MCP Servers

```typescript
await handleConfigureMCP({
  mcpServers: {
    linear: {
      command: 'npx',
      args: ['-y', '@linear/mcp-server-linear'],
      env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY }
    },
    github: {
      command: 'npx',
      args: ['-y', '@github/mcp-server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
    },
    slack: {
      url: 'https://mcp.slack.com/api',
      transport: 'sse',
      headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` }
    }
  }
}, cyrusHome);
```

### 3. Update Existing MCP Server

```typescript
// This will overwrite the existing mcp-linear.json file
await handleConfigureMCP({
  mcpServers: {
    linear: {
      command: 'npx',
      args: ['-y', '@linear/mcp-server-linear@latest'],
      env: { LINEAR_API_KEY: newApiKey }
    }
  }
}, cyrusHome);
```

### 4. Remove MCP Server

```typescript
await deleteMCPConfigFile('linear', cyrusHome);
```
