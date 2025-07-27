# Claude Runner Test Scripts

This directory contains test scripts for validating MCP (Model Context Protocol) configuration and Claude SDK functionality.

## Scripts

### `test-mcp-config.js`
Tests MCP configuration through the ClaudeRunner wrapper. This script:
- Loads MCP config from `../../../ceedardbmcpconfig.json`
- Extracts allowed tools from `../../../.cyrus-edge-config.json` 
- Uses ClaudeRunner to start a Claude session with MCP support
- Tests database queries using the `mcp__ceedardb__query` tool

**Usage:**
```bash
node test-scripts/test-mcp-config.js
```

### `test-direct-sdk.js`  
Tests MCP configuration directly through the Claude SDK. This script:
- Bypasses ClaudeRunner and uses the SDK directly
- Demonstrates how to properly parse and pass MCP configuration
- Shows detailed message flow between Claude and MCP tools
- Useful for debugging MCP connectivity issues

**Usage:**
```bash
node test-scripts/test-direct-sdk.js
```

## Configuration Requirements

Both scripts expect these files to exist in the parent directory (relative to cyrus repo root):
- `../ceedardbmcpconfig.json` - MCP server configuration
- `../.cyrus-edge-config.json` - Repository and allowed tools configuration

## Example Output

When working correctly, you should see:
1. MCP servers loaded successfully
2. Claude using the `mcp__ceedardb__query` tool
3. Database query results returned as JSON
4. Successful completion with cost and usage stats

## Troubleshooting

If the MCP tool is not available:
1. Check that the MCP config file paths are correct
2. Verify the PostgreSQL connection string and certificates
3. Ensure the `@modelcontextprotocol/server-postgres` package is available
4. Check that `mcp__ceedardb__query` is in the allowed tools list