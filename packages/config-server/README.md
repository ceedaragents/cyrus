# @cyrus-ai/config-server

Embedded HTTP server for local Cyrus configuration during onboarding. This package provides a lightweight Express-based server that exposes configuration endpoints for setting up Cyrus locally on a user's machine.

## Overview

This package is a TypeScript port of the Go-based `cyrus-update-server`, designed to run locally on user machines during the Cyrus onboarding process. It handles:

- GitHub credential configuration
- Repository cloning and management
- Cyrus configuration updates

## Installation

```bash
npm install @cyrus-ai/config-server
```

## Usage

### Basic Server Setup

```typescript
import { ConfigServer } from '@cyrus-ai/config-server';
import path from 'path';
import os from 'os';

const server = new ConfigServer({
  port: 3456,
  secret: 'your-random-secret-token',
  cyrusHome: path.join(os.homedir(), '.cyrus'),
  workspacesDir: path.join(os.homedir(), 'cyrus-workspaces'),
  repositoriesDir: path.join(os.homedir(), 'cyrus-app'),
  onConfigUpdate: (type) => {
    console.log(`Configuration updated: ${type}`);
  }
});

// Start the server
await server.start();
console.log('Config server running on port 3456');

// Later, stop the server
await server.stop();
```

### With ngrok (Typical Onboarding Use Case)

```typescript
import { ConfigServer } from '@cyrus-ai/config-server';
import ngrok from '@ngrok/ngrok';

// Start config server
const server = new ConfigServer({
  port: 3456,
  secret: generateRandomSecret(),
  cyrusHome: getCyrusHome()
});

await server.start();

// Start ngrok tunnel
const listener = await ngrok.connect({
  addr: 3456,
  authtoken: process.env.NGROK_TOKEN
});

console.log(`Config server accessible at: ${listener.url()}`);
```

## API Endpoints

All protected endpoints require Bearer token authentication:

```
Authorization: Bearer <secret>
```

### Public Endpoints

#### `GET /health`

Health check endpoint. Returns server status, version, and uptime.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12345
}
```

### Protected Endpoints

#### `POST /api/config/github`

Update GitHub credentials using GitHub CLI.

**Request:**
```json
{
  "token": "ghp_xxxxxxxxxxxxx"
}
```

**Response:**
```json
{
  "success": true,
  "message": "GitHub credentials updated successfully"
}
```

#### `POST /api/config/cyrus-config`

Update main Cyrus configuration file.

**Request:**
```json
{
  "repositories": [
    {
      "id": "uuid",
      "name": "my-repo",
      "repositoryPath": "/path/to/repo",
      "baseBranch": "main",
      "linearWorkspaceId": "workspace-id",
      "linearToken": "lin_api_xxx"
    }
  ],
  "stripeCustomerId": "cus_xxx",
  "backupConfig": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cyrus configuration updated successfully"
}
```

#### `GET /api/cyrus-config`

Retrieve current Cyrus configuration.

**Response:**
```json
{
  "repositories": [...],
  "disallowedTools": [...],
  ...
}
```

#### `POST /api/config/repository`

Clone a repository.

**Request:**
```json
{
  "repository_url": "https://github.com/owner/repo",
  "repository_name": "optional-name"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Repository cloned successfully",
  "path": "/path/to/cloned/repo"
}
```

#### `DELETE /api/config/repository`

Delete a repository and its worktrees.

**Request:**
```json
{
  "repository_name": "repo-name",
  "linear_team_key": "TEAM"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Repository deleted successfully",
  "deleted_paths": ["/path/to/repo", "/path/to/worktree1"]
}
```

#### `GET /api/repositories`

List all repositories.

**Response:**
```json
[
  {
    "name": "repo-name",
    "path": "/path/to/repo"
  }
]
```

## Direct Handler Usage

You can also use the handlers directly without running the HTTP server:

```typescript
import {
  handleGitHubCredentials,
  handleCyrusConfig,
  handleCloneRepository
} from '@cyrus-ai/config-server';

// Update GitHub credentials
await handleGitHubCredentials({ token: 'ghp_xxx' });

// Clone a repository
const clonedPath = await handleCloneRepository(
  { repository_url: 'https://github.com/owner/repo' },
  '/path/to/repositories'
);

// Update Cyrus config
await handleCyrusConfig(
  {
    repositories: [...],
    backupConfig: true
  },
  '/home/user/.cyrus'
);
```

## Architecture

The config-server is designed to run locally on the user's machine during onboarding:

```
Vercel App → ngrok tunnel → Local Config Server → Local file system
```

1. User runs `cyrus onboard --customer-id xxx`
2. CLI starts config server on random port (e.g., 3456)
3. CLI starts ngrok tunnel pointing to that port
4. User provides ngrok URL to Vercel app
5. Vercel app sends configuration requests to ngrok URL
6. Config server applies changes to local file system

## Security

- **Authentication**: Bearer token required for all config endpoints
- **Path Validation**: Prevents path traversal attacks
- **File Permissions**: Sets appropriate permissions (0644 for files, 0755 for dirs)
- **Input Sanitization**: Repository names and paths are sanitized

## Testing

```bash
npm test           # Run tests in watch mode
npm run test:run   # Run tests once
npm run typecheck  # TypeScript type checking
```

## Building

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode for development
```

## Dependencies

- **express**: HTTP server framework
- **cors**: CORS middleware
- **helmet**: Security headers
- **morgan**: HTTP request logger

## License

MIT

## Related Packages

- `@cyrus-ai/cli` - Main Cyrus CLI that uses this config server
- `cyrus-core` - Core types and utilities
