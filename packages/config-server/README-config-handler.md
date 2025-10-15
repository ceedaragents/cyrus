# Cyrus Configuration Handler

This document describes the TypeScript implementation of the Cyrus configuration handler, ported from the Go update-server.

## Overview

The config handler manages updates to the Cyrus configuration file (`config.json`), including:
- Creating/updating repository configurations
- Setting global Cyrus settings
- Backing up existing configurations
- Applying sensible defaults for optional fields
- Setting proper file permissions

## Files

- `/Users/agentops/code/cyrus-workspaces/CYPACK-185/packages/config-server/src/handlers/config-handler.ts` - Main implementation
- `/Users/agentops/code/cyrus-workspaces/CYPACK-185/packages/config-server/src/handlers/config-handler.test.ts` - Comprehensive tests

## API

### `handleCyrusConfig(payload: CyrusConfigPayload, cyrusHome: string): Promise<void>`

Main handler function that processes a configuration update request.

#### Parameters

- `payload: CyrusConfigPayload` - The configuration payload containing:
  - `repositories: RepositoryConfigItem[]` - Array of repository configurations (required)
  - `disallowedTools?: string[]` - Tools to disallow globally
  - `ngrokAuthToken?: string` - Ngrok authentication token
  - `stripeCustomerId?: string` - Stripe customer ID
  - `defaultModel?: string` - Default AI model
  - `defaultFallbackModel?: string` - Fallback AI model
  - `global_setup_script?: string` - Path to global setup script
  - `backupConfig?: boolean` - Whether to backup existing config
  - `restartCyrus?: boolean` - Whether to restart Cyrus (not implemented in this handler)

- `cyrusHome: string` - Path to the Cyrus home directory (e.g., `~/.cyrus`)

#### Example Usage

```typescript
import { handleCyrusConfig } from './handlers/config-handler';

const payload = {
  repositories: [
    {
      id: 'repo-1',
      name: 'my-project',
      repositoryPath: '/home/user/projects/my-project',
      baseBranch: 'main',
      linearWorkspaceId: 'workspace-123',
      linearToken: 'lin_api_xxx',
      isActive: true,
    },
  ],
  backupConfig: true,
};

await handleCyrusConfig(payload, '/home/user/.cyrus');
```

## Repository Configuration Defaults

When repository fields are not provided, the following defaults are applied:

| Field | Default Value |
|-------|---------------|
| `workspaceBaseDir` | `/home/cyrus/cyrus-workspaces` |
| `isActive` | `false` |
| `allowedTools` | `['Read(**)', 'Edit(**)', 'Task', 'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite', 'NotebookRead', 'NotebookEdit', 'Batch', 'Bash']` |
| `teamKeys` | `[]` |
| `labelPrompts` | `{ debugger: ['Bug'], builder: ['Feature'], scoper: ['PRD'] }` |

## Global Configuration Defaults

| Field | Default Value |
|-------|---------------|
| `disallowedTools` | `['Bash(sudo:*)']` |
| `ngrokAuthToken` | `''` |
| `stripeCustomerId` | `'cus_8172616126'` |
| `defaultModel` | `'opus'` |
| `defaultFallbackModel` | `'sonnet'` |
| `global_setup_script` | `'/opt/cyrus/scripts/global-setup.sh'` |

## Backup Behavior

When `backupConfig: true` is set in the payload:

1. Creates backup directory at `~/.cyrus/backups/` if it doesn't exist
2. Checks if an existing `config.json` exists
3. If exists, creates a timestamped backup: `config-YYYY-MM-DDTHH-MM-SS.json`
4. Continues with update even if backup fails (logs warning)

## File Permissions

- Configuration file: `0644` (read/write for owner, read for group and others)
- Backup directory: `0755` (full access for owner, read/execute for others)

## Validation

The handler validates that each repository has all required fields:
- `id` - Unique repository identifier
- `name` - Repository name
- `repositoryPath` - Absolute path to repository
- `baseBranch` - Default branch name (e.g., 'main', 'develop')

Missing any of these fields will throw an error.

## Testing

The implementation includes 14 comprehensive tests covering:
- Minimal required fields
- Default value application
- Custom value preservation
- Linear integration fields
- MCP configuration paths
- Multiple repositories
- Backup creation/skipping
- File permissions
- Directory creation
- Error handling for invalid payloads
- JSON formatting

Run tests with:
```bash
cd packages/config-server
pnpm test:run
```

## Differences from Go Implementation

1. **User/Ownership Management**: The TypeScript version does not set file ownership (no `chown` equivalent), as this is typically handled by the OS and process user context
2. **Process Restart**: The `restartCyrus` flag is accepted but not implemented in this handler (should be handled at a higher level)
3. **Timestamp Format**: Uses ISO 8601 format with modified characters for filesystem compatibility

## Integration

This handler is designed to be used within an Express.js route or similar HTTP framework. The calling code should:

1. Parse the request body into a `CyrusConfigPayload`
2. Determine the `cyrusHome` path (e.g., from environment variable or user home directory)
3. Call `handleCyrusConfig(payload, cyrusHome)`
4. Handle the returned Promise (resolve = success, reject = error)
5. Optionally restart the Cyrus process if `payload.restartCyrus` is true

Example Express route:
```typescript
app.post('/api/config', async (req, res) => {
  try {
    const payload = req.body as CyrusConfigPayload;
    const cyrusHome = process.env.CYRUS_HOME || join(os.homedir(), '.cyrus');
    
    await handleCyrusConfig(payload, cyrusHome);
    
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      repositories_count: payload.repositories.length,
      backed_up: payload.backupConfig || false,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
```
