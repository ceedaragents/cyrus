# Linear SDK Webhook Integration

This document describes the new Linear SDK webhook handling implementation in the ndjson-client package.

## Overview

The `WebhookTransportSDK` class provides an alternative webhook transport implementation that leverages the official Linear SDK's webhook handling capabilities. This offers improved type safety, automatic signature verification, and better maintainability.

## Key Features

### 1. Official Linear SDK Integration
- Uses `@linear/sdk@^57.0.0` for webhook handling
- Automatic updates with Linear API changes
- Type-safe webhook payload handling

### 2. Built-in Security
- HMAC-SHA256 signature verification
- Timing-safe comparison to prevent timing attacks
- Automatic timestamp validation

### 3. Node.js HTTP Server Support
The SDK supports raw Node.js HTTP servers without requiring any framework:

```javascript
import { createServer } from 'http';
import { LinearWebhookClient } from '@linear/sdk/webhooks';

const webhookClient = new LinearWebhookClient(webhookSecret);
const handler = webhookClient.createHandler();

// Register event handlers
handler.on('Issue', (payload) => {
  console.log('Issue event:', payload);
});

// Create HTTP server
const server = createServer(async (req, res) => {
  await handler(req, res); // SDK handles everything
});
```

### 4. Event-Driven Architecture
```javascript
// Handle specific webhook types
handler.on('Issue', handleIssueWebhook);
handler.on('Comment', handleCommentWebhook);

// Or handle all events
handler.on('*', (payload) => {
  console.log('Any webhook:', payload.type);
});
```

## Usage

### Using WebhookTransportSDK

```javascript
import { WebhookTransportSDK } from 'cyrus-ndjson-client';

const transport = new WebhookTransportSDK({
  proxyUrl: 'https://proxy.example.com',
  token: 'linear-oauth-token',
  webhookPort: 3000,
  webhookHost: 'localhost',
  webhookPath: '/webhook'
});

// Connect and start receiving webhooks
await transport.connect();

// Listen for webhook events
transport.on('event', (event) => {
  console.log('Received webhook:', event);
});
```

### Migration from WebhookTransport

The `WebhookTransportSDK` is a drop-in replacement for the original `WebhookTransport`:

```javascript
// Before
import { WebhookTransport } from 'cyrus-ndjson-client';

// After
import { WebhookTransportSDK as WebhookTransport } from 'cyrus-ndjson-client';
```

## Benefits Over Custom Implementation

1. **Maintainability**: Official SDK is maintained by Linear
2. **Type Safety**: Auto-generated TypeScript types for all webhook payloads
3. **Reliability**: Battle-tested signature verification
4. **Future-proof**: Automatic updates with Linear API changes
5. **Dual Runtime**: Works in both Node.js and Edge environments

## Webhook Payload Types

The SDK provides specific types for each webhook event:

- `EntityWebhookPayloadWithIssueData` - Issue webhooks
- `EntityWebhookPayloadWithCommentData` - Comment webhooks
- `EntityWebhookPayloadWithProjectData` - Project webhooks
- `AgentSessionEventWebhookPayload` - Agent session events
- And many more...

## Testing

Run the test script to verify the SDK integration:

```bash
cd packages/ndjson-client
node test-webhook-sdk.mjs
```

This will:
1. Start a test webhook server
2. Send a test webhook with proper signature
3. Verify the webhook is received and processed
4. Confirm the SDK works with raw Node.js HTTP

## Compatibility

- Linear SDK v57.0.0+
- Node.js 18+
- Works with raw HTTP servers (no framework required)
- Compatible with Express, Fastify, and other frameworks
- Edge runtime support (Cloudflare Workers, Vercel Edge, etc.)