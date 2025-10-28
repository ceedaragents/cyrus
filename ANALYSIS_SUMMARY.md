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
  ├─ ngrok tunnel webhooks
  └─ Cloudflare tunnel webhooks
         │
         ▼
SharedApplicationServer (/webhook endpoint)
  ├─ Routes to registered handler
  └─ Verifies HMAC signature
         │
         ▼
LinearEventTransport
Handler
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
  - ngrok tunnel integration
  - OAuth callback handler
  - Approval request management
  - HMAC signature verification via Linear SDK

**LinearEventTransport (Direct Linear Webhooks)**
- Location: `/packages/linear-event-transport/`
- Purpose: Transport for direct Linear webhook delivery
- Registration: `registerWebhookHandler(token, handler)`
- Handler Signature: `(req, res) => Promise<void>`
- Signature: Linear SDK HMAC verification

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
   a. Create LinearEventTransport
   b. Pass SharedApplicationServer as externalWebhookServer
   c. Call transport.connect()

3. Transport.connect():
   a. Register webhook with Linear
   b. Call registerWithExternalServer(SharedApplicationServer)
   c. SharedApplicationServer.registerWebhookHandler(token, handler)

4. SharedApplicationServer stores handler in webhookHandlers map

5. Incoming webhook:
   a. SharedApplicationServer routes to handler
   b. Handler verifies HMAC signature via Linear SDK
   c. Emits webhook event
   d. EdgeWorker processes event
```

### Registration Signatures

**LinearEventTransport** (Linear SDK HMAC):
```typescript
registerWebhookHandler(
  token: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
): void
```
- Returns: Promise (handler manages response)
- Used for: Linear SDK HMAC signature verification

---

## Webhook Endpoints

### All Endpoints on SharedApplicationServer

1. **POST /webhook**
   - Receives webhooks from Linear
   - Routes to registered handler
   - Verifies HMAC signature via Linear SDK

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
- `LINEAR_WEBHOOK_SECRET` - For LinearEventTransport HMAC verification

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
- LinearEventTransport: `/packages/linear-event-transport/src/LinearEventTransport.ts`
- CloudflareTunnelClient: `/packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts`

### Configuration
- CLI App: `/apps/cli/src/Application.ts`

---

## Integration Points

1. **CLI ← → SharedApplicationServer**
   - Creates temp server for OAuth
   - Listens for callback

2. **EdgeWorker ← → SharedApplicationServer**
   - Creates shared server instance
   - Passes to transport configs
   - Listens to webhook events

3. **LinearEventTransport ← → SharedApplicationServer**
   - Registers webhook handler
   - Emits webhook events

4. **Webhook Sources ← → SharedApplicationServer**
   - Direct Linear webhooks (linear-signature)
   - ngrok tunnel webhooks
   - Cloudflare tunnel webhooks

---

## Next Steps for Development

### To Understand a Specific Component
1. Start with CODEBASE_ARCHITECTURE.md for that component
2. Reference ARCHITECTURE_DIAGRAM.md for visual flow
3. Read the actual source code
4. Cross-reference with EdgeWorker integration

### To Modify Handler Registration
1. Review LinearEventTransport registration pattern
2. Check how EdgeWorker passes configs
3. Review Linear SDK signature verification logic
4. Test with LinearEventTransport

### To Enhance Webhook Handling
1. Review handleWebhookRequest() in SharedApplicationServer
2. Update handler logic in LinearEventTransport
3. Test signature verification
4. Update EdgeWorker transport setup

---

## Summary Statistics

- **Package Count**: 6 main packages + 2 apps
- **Webhook Handler Type**: 1 (Linear SDK HMAC)
- **OAuth Modes**: 2 (proxy, direct)
- **Tunnel Types**: 2 (ngrok, Cloudflare)
- **HTTP Endpoints**: 4 main routes
- **Handler Registry Maps**: 1 (webhookHandlers)
- **Supported Signature Scheme**: Linear SDK HMAC verification

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
