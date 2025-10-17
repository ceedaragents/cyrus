# Cloudflare Transport Client

A unified transport client for Cyrus that uses Cloudflare tunnels to receive webhook payloads and configuration updates from `cyrus-hosted`.

## Features

- **Cloudflare Tunnels**: No port forwarding required - uses cloudflared for secure tunneling
- **Unified Transport**: Handles both Linear webhook payloads and configuration updates
- **Secure Authentication**: Shared Bearer token authentication for all requests
- **Dynamic Configuration**: Supports runtime updates of paths, credentials, and repositories
- **Persistent State**: All configuration stored in `~/.cyrus` directory

## Installation

```bash
npm install cyrus-cloudflare-transport
```

## Usage

### Basic Setup

```typescript
import { CloudflareTransportClient } from 'cyrus-cloudflare-transport';

const transport = new CloudflareTransportClient({
  cyrusHome: '~/.cyrus',
  customerId: 'your-stripe-customer-id',
  port: 3457,  // Local port for HTTP server
});

// Listen for webhooks
transport.on('webhook', (webhook) => {
  console.log('Received webhook:', webhook.type);
  // Process webhook payload
});

// Listen for configuration updates
transport.on('config:updated', (type) => {
  console.log('Configuration updated:', type);
  // Reload configuration as needed
});

// Start the transport
await transport.start();
```

### Integration with EdgeWorker

To integrate with EdgeWorker, you can conditionally use the CloudflareTransportClient based on configuration:

```typescript
// In EdgeWorker constructor or initialization
private async setupTransport(repo: RepositoryConfig): Promise<void> {
  const transportType = process.env.CYRUS_TRANSPORT_TYPE || 'ndjson';

  if (transportType === 'cloudflare') {
    // Use new CloudflareTransportClient
    const { CloudflareTransportClient } = await import('cyrus-cloudflare-transport');

    const transport = new CloudflareTransportClient({
      cyrusHome: this.cyrusHome,
      customerId: this.config.stripeCustomerId,
      port: this.config.serverPort || 3457,
    });

    // Handle webhook events
    transport.on('webhook', (webhook) => {
      this.handleWebhook(webhook, [repo]);
    });

    // Handle config updates
    transport.on('config:updated', async (type) => {
      console.log(`Configuration updated: ${type}`);
      // Reload configuration
      await this.reloadConfiguration();
    });

    await transport.start();
    this.transports.set(repo.id, transport);

  } else {
    // Use existing NdjsonClient or LinearWebhookClient
    // ... existing transport setup logic
  }
}
```

## Configuration

The transport client stores its configuration in `~/.cyrus/transport-config.json`:

```json
{
  "customerId": "cus_xxx",
  "cloudflareToken": "xxx",
  "tunnelUrl": "https://xxx.trycloudflare.com",
  "authKey": "xxx",
  "paths": {
    "cyrusApp": "/path/to/repos",
    "cyrusWorkspaces": "/path/to/workspaces"
  },
  "linearCredentials": {
    "token": "xxx",
    "workspaceId": "xxx",
    "workspaceName": "My Workspace"
  },
  "githubCredentials": {
    "appId": "xxx",
    "privateKey": "xxx",
    "installationId": "xxx"
  },
  "claudeApiKey": "xxx",
  "repositories": []
}
```

## API Endpoints

The transport client exposes the following endpoints:

### Health & Status
- `GET /health` - Health check (no auth required)
- `GET /status` - Detailed status information

### Configuration Updates
- `GET /config` - Get current configuration
- `POST /config/paths` - Update cyrus-app and cyrus-workspaces paths
- `POST /config/github-credentials` - Update GitHub app credentials
- `POST /config/linear-credentials` - Update Linear OAuth token
- `POST /config/claude-api-key` - Update Claude API key
- `POST /config/repositories` - Update repository configurations

### Webhook Processing
- `POST /webhook` - Receive Linear webhook payloads

## Customer Onboarding Flow

1. **Customer ID Validation**: On first start, the client validates the customer ID with `cyrus-hosted`
2. **Cloudflare Token Receipt**: Receives Cloudflare tunnel token as part of validation response
3. **Tunnel Establishment**: Creates secure tunnel using the provided token
4. **URL Registration**: Registers the tunnel URL back to `cyrus-hosted` for routing

## Security

- All requests require `Authorization: Bearer <shared-key>` header
- Linear webhook signatures are validated when configured
- Paths are validated before storage
- Sensitive data is never exposed in GET requests

## Environment Variables

- `CYRUS_HOSTED_URL` - URL of the cyrus-hosted service (default: https://cyrus-hosted.vercel.app)
- `LINEAR_WEBHOOK_SECRET` - Secret for validating Linear webhook signatures
- `NODE_ENV` - Environment (production/development)
- `CYRUS_TRANSPORT_TYPE=cloudflare` - Enable CloudflareTransport in EdgeWorker

## Error Handling

The client implements robust error handling:
- Automatic retry with exponential backoff for tunnel failures
- Graceful handling of missing configuration
- Detailed error messages for troubleshooting
- Continues operation even if tunnel registration fails

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Migration from Existing Transports

For users migrating from `ndjson-client` or direct Linear webhooks:

1. Set environment variable: `export CYRUS_TRANSPORT_TYPE=cloudflare`
2. Run `cyrus set-customer-id <your-customer-id>`
3. Start Cyrus - it will automatically validate and receive the Cloudflare token
4. The tunnel will be established and webhooks will flow through `cyrus-hosted`

## License

ISC