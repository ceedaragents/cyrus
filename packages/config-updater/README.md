# cyrus-config-updater

Configuration update handler module for Cyrus that handles API requests to update:
- Cyrus configuration (config.json)
- Environment variables (.env)
- Repository cloning/verification
- MCP server configuration
- MCP connection testing

## Installation

```bash
pnpm add cyrus-config-updater
```

## Usage

```typescript
import { ConfigUpdater } from 'cyrus-config-updater';
import type { ConfigUpdaterConfig } from 'cyrus-config-updater';

const config: ConfigUpdaterConfig = {
  cyrusHome: '/Users/username/.cyrus',
  apiKey: 'your-api-key',
  onConfigUpdate: () => {
    console.log('Configuration updated');
  },
  onRestart: (reason) => {
    console.log(`Restart requested: ${reason}`);
  },
  onError: (error) => {
    console.error('Error:', error);
  }
};

const configUpdater = new ConfigUpdater(config);

// Register handlers with SharedApplicationServer
configUpdater.registerHandlers((path, handler) => {
  server.registerHandler(path, handler);
});
```

## Features

- **Configuration Updates**: Update Cyrus config.json with repository settings
- **Environment Variables**: Update .env file with Claude API tokens
- **Repository Management**: Clone and verify Git repositories
- **MCP Configuration**: Configure MCP servers for Claude
- **MCP Testing**: Test MCP server connections
- **Authentication**: Bearer token authentication for all endpoints
- **Event Emission**: Emits events for config updates, restarts, and errors

## API Endpoints

All endpoints require `Authorization: Bearer <api-key>` header.

### POST /api/update/cyrus-config

Update Cyrus configuration file.

### POST /api/update/cyrus-env

Update environment variables.

### POST /api/update/repository

Clone or verify a Git repository.

### POST /api/test-mcp

Test MCP server connection.

### POST /api/configure-mcp

Configure MCP servers.
