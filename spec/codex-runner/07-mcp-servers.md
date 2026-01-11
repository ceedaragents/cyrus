# MCP Servers Research

## Codex MCP Server Support

Codex has experimental MCP (Model Context Protocol) support for extending agent capabilities.

### MCP Management Commands

```bash
# List configured MCP servers
codex mcp list

# Add a server
codex mcp add my-tool -- my-command

# Get server details
codex mcp get my-tool

# Remove a server
codex mcp remove my-tool

# OAuth login for a server (experimental)
codex mcp login server-name

# OAuth logout
codex mcp logout server-name
```

### Configuration in config.toml

From the Codex source (`config/types.rs`), MCP servers support two transport types:

#### Stdio Transport (Local Process)
```toml
[mcp_servers.my-local-server]
transport = "stdio"
command = "node"
args = ["./my-mcp-server.js"]
cwd = "/path/to/server"
env = { "API_KEY" = "secret" }
startup_timeout = { secs = 30 }
tool_timeout = { secs = 60 }
enabled_tools = ["tool1", "tool2"]  # Allowlist
disabled_tools = ["tool3"]           # Denylist
enabled = true
```

#### Streamable HTTP Transport
```toml
[mcp_servers.remote-server]
transport = "streamable_http"
url = "https://mcp.example.com/sse"
bearer_env_var = "MCP_BEARER_TOKEN"  # Read from environment
headers = { "X-Custom" = "value" }
startup_timeout = { secs = 30 }
tool_timeout = { secs = 60 }
enabled = true
```

### Feature Flags for MCP

```bash
codex features list
# rmcp_client  experimental  false
```

The `rmcp_client` feature enables experimental OAuth support for MCP servers.

### MCP Event in JSONL Output

```typescript
type McpToolCallItem = {
  id: string;
  type: "mcp_tool_call";
  server_name: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "in_progress" | "completed" | "failed";
};
```

### Implementation for CodexRunner

```typescript
interface McpServerConfig {
  transport: "stdio" | "streamable_http";
  // Stdio transport
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  // HTTP transport
  url?: string;
  bearer_env_var?: string;
  headers?: Record<string, string>;
  // Common
  startup_timeout?: { secs: number };
  tool_timeout?: { secs: number };
  enabled_tools?: string[];
  disabled_tools?: string[];
  enabled?: boolean;
}

interface CodexRunnerConfig extends AgentRunnerConfig {
  // MCP configuration paths (like GeminiRunner)
  mcpConfigPath?: string | string[];
  mcpConfig?: Record<string, McpServerConfig>;
}

class CodexRunner {
  private async setupMcpServers(): Promise<() => void> {
    const mcpServers = await this.buildMcpServers();

    if (Object.keys(mcpServers).length === 0) {
      return () => {};  // No cleanup needed
    }

    // Read existing config
    const configPath = path.join(this.codexHome, 'config.toml');
    const existingConfig = existsSync(configPath)
      ? readFileSync(configPath, 'utf-8')
      : '';

    // Parse and merge MCP servers
    const config = TOML.parse(existingConfig);
    config.mcp_servers = {
      ...(config.mcp_servers || {}),
      ...mcpServers,
    };

    // Write updated config
    const updatedConfig = TOML.stringify(config);
    writeFileSync(configPath, updatedConfig);

    // Return cleanup function
    return () => {
      writeFileSync(configPath, existingConfig);
    };
  }

  private async buildMcpServers(): Promise<Record<string, McpServerConfig>> {
    const servers: Record<string, McpServerConfig> = {};

    // 1. Auto-detect .mcp.json in working directory
    const mcpJsonPath = path.join(this.workingDirectory, '.mcp.json');
    if (existsSync(mcpJsonPath)) {
      const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      Object.assign(servers, this.convertMcpJsonToCodexFormat(mcpJson));
    }

    // 2. Load from explicit paths
    if (this.config.mcpConfigPath) {
      const paths = Array.isArray(this.config.mcpConfigPath)
        ? this.config.mcpConfigPath
        : [this.config.mcpConfigPath];
      for (const p of paths) {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        Object.assign(servers, this.convertMcpJsonToCodexFormat(config));
      }
    }

    // 3. Merge inline config (overrides)
    if (this.config.mcpConfig) {
      Object.assign(servers, this.config.mcpConfig);
    }

    return servers;
  }

  private convertMcpJsonToCodexFormat(
    mcpJson: Record<string, any>
  ): Record<string, McpServerConfig> {
    const result: Record<string, McpServerConfig> = {};

    for (const [name, config] of Object.entries(mcpJson.mcpServers || mcpJson)) {
      if (config.command) {
        result[name] = {
          transport: "stdio",
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          env: config.env,
        };
      } else if (config.url) {
        result[name] = {
          transport: "streamable_http",
          url: config.url,
          headers: config.headers,
        };
      }
    }

    return result;
  }
}
```

### Comparison Table

| Aspect | ClaudeRunner | GeminiRunner | CodexRunner |
|--------|--------------|--------------|-------------|
| Config Format | JSON (SDK native) | JSON (settings.json) | TOML (config.toml) |
| Auto-detect | .mcp.json | .mcp.json | .mcp.json (needs conversion) |
| Transport Types | HTTP | stdio, SSE, HTTP | stdio, streamable_http |
| Tool Filtering | Per-server | Per-server | enabled_tools/disabled_tools |
| OAuth Support | Via SDK | No | Experimental (rmcp_client) |

### Key Differences

1. **TOML Format**: Codex uses TOML for configuration, not JSON
2. **Different Key Names**: `enabled_tools` vs `includeTools`, `disabled_tools` vs `excludeTools`
3. **Timeout Format**: Uses `{ secs: N }` object instead of milliseconds
4. **No Auto-Trust**: Unlike Gemini, need to explicitly enable servers
