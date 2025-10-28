# cyrus-cloudflare-tunnel-client

Cloudflare tunnel client for receiving Linear webhooks from cyrus-hosted.

## Overview

This package provides a transport client that uses Cloudflare tunnels to receive Linear webhook payloads forwarded through cyrus-hosted.

**Note**: Configuration management has been extracted to the `cyrus-config-updater` package. This client is now focused solely on tunnel establishment and webhook delivery.

## Features

- **Cloudflare Tunnel**: Automatic tunnel setup using cloudflared binary
- **HTTP Server**: Handles incoming webhook requests
- **API Key Authentication**: Secures all incoming requests
- **Error Handling**: Comprehensive error handling and event emission

## Installation

```bash
npm install cyrus-cloudflare-tunnel-client
```

## Usage

```typescript
import { CloudflareTunnelClient } from 'cyrus-cloudflare-tunnel-client';

const client = new CloudflareTunnelClient({
  onWebhook: (payload) => {
    console.log('Received webhook:', payload);
  },
  onReady: (tunnelUrl) => {
    console.log('Tunnel ready:', tunnelUrl);
  },
  onError: (error) => {
    console.error('Error:', error);
  },
});

// Start tunnel with Cloudflare token and API key
await client.startTunnel(cloudflareToken, apiKey);

// Wait for onReady event with tunnel URL
// Tunnel is now ready to receive webhooks from cyrus-hosted
```

## API Endpoints

The client exposes this endpoint for cyrus-hosted:

### `/webhook`
Receive Linear webhook payloads forwarded from cyrus-hosted. All webhook payloads are emitted via the `webhook` event.

## Configuration Management

Configuration management (updating `~/.cyrus/config.json`, `.env`, MCP configs, and repository cloning) has been moved to the separate `cyrus-config-updater` package. Use that package for all configuration operations.

## Authentication

- All requests must include `Authorization: Bearer {apiKey}` header
- API key is provided when starting the tunnel via `startTunnel(cloudflareToken, apiKey)`
- Cloudflare tunnel provides encrypted connection

## Events

The client emits the following events:

- `ready`: Fired when the tunnel is established with the tunnel URL
- `connect`: Fired when Cloudflare establishes a connection
- `disconnect`: Fired when the tunnel disconnects
- `webhook`: Fired when a Linear webhook is received
- `error`: Fired when an error occurs

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

MIT
