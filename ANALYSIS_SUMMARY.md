# Codebase Analysis Summary

## Documents Generated

This analysis has created three comprehensive documents detailing the Cyrus codebase architecture:

### 1. **CODEBASE_ARCHITECTURE.md** - Main Reference
Complete technical documentation including:
- Executive summary of the unified webhook pattern
- Package structure and relationships
- Detailed component analysis
  - SharedApplicationServer.ts (1,133 lines)
  - NdjsonClient package
  - LinearWebhookClient package
  - CloudflareTunnelClient package
  - EdgeWorker.ts integration
- Handler registration signatures
- OAuth flow (proxy and direct modes)
- Current usage patterns
- ngrok vs Cloudflare implementations
- Design patterns and key insights
- Dependencies and configuration
- Current state summary

### 2. **ARCHITECTURE_DIAGRAM.md** - Visual Reference
ASCII diagrams showing:
- High-level component architecture
- Webhook flow from Linear to processing
- Request flow for webhook registration
- Handler call stack and routing logic
- Data flow: token to handler registration
- Port and URL resolution
- Complete step-by-step integration example

### 3. **ANALYSIS_SUMMARY.md** (this file)
Quick reference guide with key findings

---

## Key Findings

### Current Architecture

The Cyrus codebase has evolved toward a **unified webhook server pattern**:

```
Linear Webhooks (3 possible sources)
  ├─ Direct webhooks (linear-signature header)
  ├─ Proxy webhooks (x-webhook-signature header)  
  └─ Cloudflare tunnel webhooks
         │
         ▼
SharedApplicationServer (/webhook endpoint)
  ├─ Detects webhook type
  ├─ Routes to registered handler
  └─ Verifies signature
         │
    ┌────┴────┐
    ▼         ▼
NdjsonClient  LinearWebhookClient
Handler       Handler
    │         │
    └────┬────┘
         │
    ┌────▼──────────────┐
    │ EdgeWorker        │
    │ handleWebhook()   │
    │                   │
    │ - Parse event     │
    │ - Create session  │
    │ - Run Claude      │
    │ - Post to Linear  │
    └───────────────────┘
```

### Component Relationships

**SharedApplicationServer (Central Hub)**
- Location: `/packages/edge-worker/src/SharedApplicationServer.ts`
- Purpose: Single HTTP server for all webhooks and OAuth flows
- Key Features:
  - Handles 2+ webhook styles simultaneously
  - ngrok tunnel integration
  - OAuth callback handler
  - Approval request management
  - HMAC and Linear signature verification

**NdjsonClient (Proxy-based)**
- Location: `/packages/ndjson-client/`
- Purpose: Client for proxy-based webhook delivery
- Registration: `registerWebhookHandler(token, secret, handler)`
- Handler Signature: `(body, sig, timestamp) => boolean`
- Signature: HMAC-SHA256

**LinearWebhookClient (Direct-based)**
- Location: `/packages/linear-webhook-client/`
- Purpose: Client for direct Linear webhook delivery
- Registration: `registerWebhookHandler(token, handler)`
- Handler Signature: `(req, res) => Promise<void>`
- Signature: Linear SDK validates `linear-signature` header

**CloudflareTunnelClient (Remote Deployment)**
- Location: `/packages/cloudflare-tunnel-client/`
- Purpose: Establish tunnel to cyrus-hosted service
- Features: Remote config updates, webhook distribution
- Use Case: When using cloud-hosted proxy

**EdgeWorker (Orchestration)**
- Location: `/packages/edge-worker/src/EdgeWorker.ts`
- Purpose: Manage clients, webhooks, Claude sessions
- Relationships:
  - Creates SharedApplicationServer
  - Passes it to client configs
  - Listens to webhook events
  - Manages Claude sessions
  - Handles Linear API interactions

---

## Handler Registration Pattern

### Flow

```
1. EdgeWorker creates SharedApplicationServer

2. For each unique Linear token:
   a. Create NdjsonClient or LinearWebhookClient
   b. Pass SharedApplicationServer as externalWebhookServer
   c. Call client.connect()
   
3. Client.connect():
   a. (NdjsonClient) Register with proxy → get webhookSecret
   b. Call registerWithExternalServer(SharedApplicationServer)
   c. SharedApplicationServer.registerWebhookHandler(token, secret, handler)

4. SharedApplicationServer stores handler:
   - NdjsonClient: webhookHandlers map
   - LinearWebhookClient: linearWebhookHandlers map

5. Incoming webhook:
   a. SharedApplicationServer detects type (via headers)
   b. Routes to correct handler type
   c. Handler verifies signature
   d. Emits webhook event
   e. EdgeWorker processes event
```

### Registration Signatures

**NdjsonClient** (Proxy-style, HMAC):
```typescript
registerWebhookHandler(
  token: string,
  secret: string,
  handler: (body: string, signature: string, timestamp?: string) => boolean
): void
```
- Returns: boolean (true = handled, false = try next)
- Used for: HMAC signature verification

**LinearWebhookClient** (Direct-style, Linear SDK):
```typescript
registerWebhookHandler(
  token: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
): void
```
- Returns: Promise (handler manages response)
- Used for: Linear SDK signature verification

---

## Webhook Endpoints

### All Endpoints on SharedApplicationServer

1. **POST /webhook**
   - Receives webhooks from all sources
   - Auto-detects type via headers
   - Routes to appropriate handler
   - Supports multiple simultaneous handlers

2. **GET /callback**
   - OAuth callback (proxy mode)
   - Direct Linear callback (external host mode)

3. **GET /oauth/authorize**
   - Direct Linear OAuth flow

4. **GET /approval**
   - User approval/rejection UI

---

## Configuration

### Environment Variables

**Server**:
- `CYRUS_SERVER_PORT` - Port for HTTP server (default: 3456)
- `CYRUS_BASE_URL` - Override base URL (set by ngrok)
- `CYRUS_HOST_EXTERNAL` - Use external host (disables ngrok)

**OAuth**:
- `LINEAR_CLIENT_ID` - For direct Linear OAuth
- `LINEAR_CLIENT_SECRET` - For direct Linear OAuth
- `PROXY_URL` - Proxy server URL (default: cyrus-proxy.com)

**Webhooks**:
- `LINEAR_WEBHOOK_SECRET` - For LinearWebhookClient
- `LINEAR_DIRECT_WEBHOOKS` - Use direct webhooks

### Port Selection

- Default: 3456
- Configurable via CYRUS_SERVER_PORT
- Used for both HTTP server and ngrok tunnel
- All webhook clients use same port via SharedApplicationServer

---

## Design Benefits

1. **Single Port**: All webhooks through one endpoint
2. **Scalability**: Unlimited simultaneous handlers
3. **Flexibility**: Support multiple webhook types
4. **Simplicity**: Clients don't create servers
5. **Robustness**: Centralized error handling
6. **Testability**: Easy to mock

---

## File Locations Reference

### Core Components
- SharedApplicationServer: `/packages/edge-worker/src/SharedApplicationServer.ts`
- EdgeWorker: `/packages/edge-worker/src/EdgeWorker.ts`
- NdjsonClient: `/packages/ndjson-client/src/NdjsonClient.ts`
- LinearWebhookClient: `/packages/linear-webhook-client/src/LinearWebhookClient.ts`
- CloudflareTunnelClient: `/packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts`

### Transport Layers
- NdjsonClient WebhookTransport: `/packages/ndjson-client/src/transports/WebhookTransport.ts`
- LinearWebhookClient WebhookTransport: `/packages/linear-webhook-client/src/transports/WebhookTransport.ts`

### Configuration
- CLI App: `/apps/cli/src/Application.ts`
- Proxy Worker: `/apps/proxy-worker/` (OAuth/webhook proxy)

---

## Integration Points

1. **CLI ← → SharedApplicationServer**
   - Creates temp server for OAuth
   - Listens for callback

2. **EdgeWorker ← → SharedApplicationServer**
   - Creates shared server instance
   - Passes to client configs
   - Listens to webhook events

3. **NdjsonClient ← → SharedApplicationServer**
   - Registers proxy-style handler
   - Emits webhook events

4. **LinearWebhookClient ← → SharedApplicationServer**
   - Registers direct-style handler
   - Emits webhook events

5. **Webhook Sources ← → SharedApplicationServer**
   - Direct webhooks (linear-signature)
   - Proxy webhooks (x-webhook-signature)
   - Cloudflare tunnel webhooks

---

## Next Steps for Development

### To Understand a Specific Component
1. Start with CODEBASE_ARCHITECTURE.md for that component
2. Reference ARCHITECTURE_DIAGRAM.md for visual flow
3. Read the actual source code
4. Cross-reference with EdgeWorker integration

### To Modify Handler Registration
1. Understand both registration styles
2. Check how EdgeWorker passes configs
3. Review signature verification logic
4. Test with both NdjsonClient and LinearWebhookClient

### To Add New Webhook Type
1. Add detection logic in handleWebhookRequest()
2. Create new handler map in SharedApplicationServer
3. Implement handler registration method
4. Update EdgeWorker client setup

---

## Summary Statistics

- **Package Count**: 7 main packages + 2 apps
- **Webhook Handler Types**: 2 (proxy-style, direct-style)
- **OAuth Modes**: 2 (proxy, direct)
- **Tunnel Types**: 2 (ngrok, Cloudflare)
- **HTTP Endpoints**: 4 main routes
- **Handler Registry Maps**: 2 (webhookHandlers, linearWebhookHandlers)
- **Supported Signature Schemes**: 2 (HMAC-SHA256, Linear SDK)

---

## Quick Reference

### Start Here
- Architecture overview: CODEBASE_ARCHITECTURE.md (Executive Summary)
- Visual flow: ARCHITECTURE_DIAGRAM.md (High-Level Component Architecture)

### Deep Dives
- Webhook registration: CODEBASE_ARCHITECTURE.md (Handler Registration Signatures)
- Token flow: ARCHITECTURE_DIAGRAM.md (Data Flow: Token to Handler Registration)
- Integration example: ARCHITECTURE_DIAGRAM.md (Complete Integration Example)

### Configuration
- Environment variables: CODEBASE_ARCHITECTURE.md (Configuration Environment Variables)
- Port resolution: ARCHITECTURE_DIAGRAM.md (Port and URL Resolution)

---

Generated: October 27, 2025
Analysis Tool: Claude Code
Repository: CYPACK-235
Branch: cyrus-235
