# Cyrus Codebase Architecture Analysis

## Executive Summary

The Cyrus codebase is a TypeScript/JavaScript monorepo organized with a clear separation of concerns:
- **Apps**: CLI (main application)
- **Packages**: Shared libraries for edge workers, clients, and utilities

The architecture has evolved toward a **unified webhook handling pattern** where:
1. A single `SharedApplicationServer` manages HTTP webhooks and OAuth flows
2. Multiple `LinearEventTransport` instances register handlers with the shared server
3. All clients use a common tunnel infrastructure (ngrok or Cloudflare)

---

## Package Structure

```
cyrus-workspaces/
├── apps/
│   └── cli/               # Main CLI application
│
└── packages/
    ├── cloudflare-tunnel-client/  # Cloudflare tunnel implementation
    ├── linear-event-transport/    # Linear webhook transport with HMAC verification
    ├── edge-worker/               # Main orchestration engine
    ├── claude-runner/             # Claude Code execution
    ├── core/                      # Shared types and utilities
    └── simple-agent-runner/       # Simplified agent runner
```

---

## Component Deep Dive

### 1. SharedApplicationServer.ts
**Location**: `/packages/edge-worker/src/SharedApplicationServer.ts`

**Purpose**: 
Central HTTP server that handles both webhooks and OAuth callbacks on a single port, replacing the need for separate webhook servers per client.

**Key Characteristics**:
- **Port Management**: Configurable port (default 3456) and host
- **ngrok Integration**: Automatic tunnel setup for external exposure
- **Webhook Handling**:
  - Direct Linear webhooks with HMAC signature verification

**Registered Handlers**:

1. **Webhook Handler** (`/webhook` - POST)
   - Routes incoming POST requests to registered webhook handlers
   - Uses Linear webhook signature verification with HMAC
   - Signature verification per handler

2. **OAuth Callback Handler** (`/callback` - GET)
   - Receives OAuth credentials from proxy
   - Supports both proxy-based and direct Linear OAuth
   - Stores credentials temporarily and resolves waiting promises
   - Calls registered `OAuthCallbackHandler`

3. **OAuth Authorize Handler** (`/oauth/authorize` - GET)
   - Direct Linear OAuth flow (when CYRUS_HOST_EXTERNAL=true)
   - Generates CSRF state tokens
   - Redirects to Linear OAuth endpoint

4. **Direct Linear Callback** (`/callback` - GET with code+state)
   - Handles authorization code exchange
   - Exchanges code for access token
   - Fetches workspace info via GraphQL

5. **Approval Handler** (`/approval` - GET)
   - Shows approval UI for user decisions
   - Handles approval/rejection with optional feedback
   - Expires after 30 minutes

**Key Methods**:
```typescript
start(): Promise<void>                           // Start HTTP server + ngrok
stop(): Promise<void>                            // Shutdown gracefully
registerWebhookHandler(token, secret|fn, fn?)   // Register webhook handler
registerOAuthCallbackHandler(handler)            // Register OAuth handler
startOAuthFlow(proxyUrl): Promise<credentials>   // Initiate OAuth
getBaseUrl(): string                             // Get server URL (ngrok or local)
registerApprovalRequest(sessionId): {promise, url}  // Create approval
```

**State Management**:
- `webhookHandlers`: Linear webhook handlers (token -> {secret, handler})
- `oauthCallbacks`: Pending OAuth flows (flowId -> {resolve, reject})
- `oauthStates`: CSRF tokens for direct OAuth
- `pendingApprovals`: User approval requests (sessionId -> callback)

---

### 2. LinearEventTransport Package
**Location**: `/packages/linear-event-transport/`

**Purpose**:
Client for receiving webhooks directly from Linear with HMAC signature verification.

**Entry Point**: `LinearEventTransport.ts`
```typescript
export class LinearEventTransport extends EventEmitter {
  private webhookClient: LinearWebhookClient;

  async connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
}
```

**Key Events**:
- `connect`: Connected to webhook system
- `disconnect`: Connection lost
- `webhook`: Linear webhook payload
- `error`: Connection error

**Transport Layer**:

1. **Linear SDK Webhook Integration**:
   - Uses `@linear/sdk/webhooks` for webhook handling
   - Validates `linear-signature` header using Linear's HMAC verification
   - Automatically registers webhook with Linear

2. **Registration with SharedApplicationServer**:
   - Registers handler with SharedApplicationServer
   - Handler verifies HMAC signature using Linear webhook secret
   - Emits webhook events for processing

**Configuration**:
```typescript
interface LinearEventTransportConfig {
  token: string                       // Linear token
  webhookPort?: number                // Port for webhook server
  webhookHost?: string                // Host for webhook server
  webhookBaseUrl?: string             // Full webhook URL
  webhookPath?: string                // Webhook endpoint path
  externalWebhookServer?: any         // SharedApplicationServer
  useExternalWebhookServer?: boolean  // Use shared server
  onWebhook?: (payload: LinearWebhookPayload) => void
  onConnect/Disconnect/Error?: callback
}
```

---

### 3. CloudflareTunnelClient Package
**Location**: `/packages/cloudflare-tunnel-client/`

**Purpose**:
Client for establishing Cloudflare tunnel to cyrus-hosted service.

**Entry Point**: `CloudflareTunnelClient.ts`
```typescript
export class CloudflareTunnelClient extends EventEmitter {
  async startTunnel(cloudflareToken: string, apiKey: string): Promise<void>
  getTunnelUrl(): string | null
  isConnected(): boolean
  disconnect(): void
}
```

**Key Features**:

1. **Cloudflare Tunnel Setup**:
   - Uses `cloudflared` package
   - Creates HTTP server on port 3456
   - Establishes tunnel via `Tunnel.withToken(cloudflareToken)`
   - Supports remotely-managed tunnels (no manual URL)

2. **Connection Lifecycle**:
   - Waits for 4 connections (Cloudflare standard)
   - Emits `ready` with tunnel URL
   - Monitors `connected`, `error`, `exit` events

3. **API Endpoints** (receive from cyrus-hosted):
   - `/api/update/cyrus-config` - Config updates
   - `/api/update/cyrus-env` - Environment variables
   - `/api/update/repository` - Repository configuration
   - `/api/test-mcp` - MCP server testing
   - `/api/configure-mcp` - MCP configuration
   - `/webhook` - Linear webhooks

4. **Authentication**:
   - Bearer token validation: `Authorization: Bearer ${apiKey}`
   - Ensures only cyrus-hosted can send commands

**Handlers** (`/src/handlers/`):
- `configureMcp.ts` - Configure MCP servers
- `cyrusConfig.ts` - Update main config
- `cyrusEnv.ts` - Update environment variables
- `repository.ts` - Register repositories
- `testMcp.ts` - Test MCP connectivity

---

### 4. EdgeWorker.ts
**Location**: `/packages/edge-worker/src/EdgeWorker.ts`

**Purpose**:
Orchestrates the entire edge worker, managing webhooks, Claude sessions, and Linear integration.

**Key Components**:

1. **Webhook Client Management**:
   ```typescript
   private linearEventTransports: Map<string, LinearEventTransport>
   ```
   - One transport per Linear token
   - Clients share the `SharedApplicationServer`
   - Each repository can have different tokens

2. **Webhook Registration Flow**:

   For each Linear token:
   ```
   1. Create LinearEventTransport
   2. Set useExternalWebhookServer: true
   3. Pass this.sharedApplicationServer as externalWebhookServer
   4. On connect, client calls:
      - registerWithExternalServer() with SharedApplicationServer
      - SharedApplicationServer.registerWebhookHandler(token, handler)
   5. Incoming webhooks routed through SharedApplicationServer
   ```

3. **SharedApplicationServer Integration**:
   ```typescript
   private sharedApplicationServer: SharedApplicationServer;
   
   constructor(config: EdgeWorkerConfig) {
     this.sharedApplicationServer = new SharedApplicationServer(
       config.serverPort || 3456,
       config.serverHost || "localhost",
       config.ngrokAuthToken,
       config.proxyUrl
     );
     
     // Register OAuth callback handler
     if (config.handlers?.onOAuthCallback) {
       this.sharedApplicationServer.registerOAuthCallbackHandler(...)
     }
   }
   ```

4. **Client Configuration Pattern**:
   ```typescript
   const transportConfig = {
     token: token,
     // CRITICAL: Use shared application server
     useExternalWebhookServer: true,
     externalWebhookServer: this.sharedApplicationServer,
     webhookPort: serverPort,
     webhookPath: "/webhook",
     webhookHost: serverHost,
     onConnect: () => this.handleConnect(repoId, repos),
     onDisconnect: (reason) => this.handleDisconnect(repoId, repos, reason),
     onError: (error) => this.handleError(error),
     onWebhook: (payload) => this.handleWebhook(payload, repos),
   };

   const transport = new LinearEventTransport(transportConfig);
   ```

5. **Webhook Handling**:
   - LinearEventTransport: `onWebhook` callback in config
   - Routes to `this.handleWebhook(payload, repos)`

6. **OAuth Flow**:
   ```typescript
   async startOAuthFlow(oauthProxyUrl: string) {
     return this.sharedApplicationServer.startOAuthFlow(oauthProxyUrl);
   }
   ```

---

## Webhook Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     INCOMING WEBHOOK                             │
│                     (Linear Webhook Server)                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                ┌──────────┴────────┬──────────────────┐
                │                   │                  │
         [Direct: via Linear]  [ngrok Tunnel]    [Cloudflare: via Tunnel]
                │                   │                  │
                ▼                   ▼                  ▼
        ┌──────────────┐     ┌────────────┐    ┌─────────────────┐
        │ Direct Link  │     │   ngrok    │    │ Cloudflare      │
        │ (linear-sig) │     │   Tunnel   │    │ Tunnel          │
        └──────┬───────┘     └─────┬──────┘    └────────┬────────┘
               │                   │                    │
               └───────────────────┼────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ SharedApplicationServer:   │
                    │ /webhook (POST)            │
                    │                            │
                    │ - Routes to handler        │
                    │ - Verifies HMAC signature  │
                    └──────────────┬─────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────┐
                    │ LinearEventTransport      │
                    │ registerHandler           │
                    │ (token, handler)          │
                    │                           │
                    │ Verifies Linear HMAC      │
                    │ Emits webhook event       │
                    └────────┬──────────────────┘
                             │
                ┌────────────▼──────────┐
                │ EdgeWorker.           │
                │ handleWebhook()       │
                │                       │
                │ - Parse Linear event  │
                │ - Create/resume issue │
                │ - Start session       │
                │ - Post to Linear      │
                └───────────────────────┘
```

---

## Handler Registration Signatures

### SharedApplicationServer Signatures

**LinearEventTransport Handler**:
```typescript
registerWebhookHandler(
  token: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
): void
```
- **Return**: Promise (handler manages response)
- **Usage**: Called when Linear webhook is received
- **Verification**: Handler (via Linear SDK) verifies HMAC signature using webhook secret

---

## OAuth Flow

### Proxy-based OAuth (Default)
```
User runs: cyrus login
    │
    ├─> Application.createTempServer()
    │   └─> SharedApplicationServer started on port 3456
    │
    ├─> sharedApplicationServer.startOAuthFlow(proxyUrl)
    │   └─> Opens browser to /oauth/authorize on proxy
    │       └─> Proxy shows Linear OAuth consent screen
    │
    └─> User authorizes → Proxy redirects to /callback on edge
        └─> /callback handler receives token, workspaceId, workspaceName
            └─> Resolves promise with credentials
                └─> CLI saves to config.json
```

### Direct OAuth (CYRUS_HOST_EXTERNAL=true)
```
User runs: cyrus login
    │
    ├─> sharedApplicationServer.startOAuthFlow()
    │
    ├─> /oauth/authorize handler
    │   └─> Checks LINEAR_CLIENT_ID
    │   └─> Generates state token
    │   └─> Redirects to Linear OAuth
    │
    └─> User authorizes → Linear redirects to /callback
        └─> /callback handler with code + state
            └─> Exchanges code for token
            └─> Fetches workspace info via GraphQL
            └─> Shows success page + closes browser
```

---

## Current Usage in EdgeWorker

### Client Setup (start() method):
```typescript
async setupTransportsForTokens() {
  for (const token of uniqueTokens) {
    const repos = this.getRepositoriesForToken(token);

    const transportConfig = {
      token: token,
      useExternalWebhookServer: true,
      externalWebhookServer: this.sharedApplicationServer,  // ← KEY
      webhookPort: serverPort,
      webhookPath: "/webhook",
      webhookHost: serverHost,
      onWebhook: (payload) => this.handleWebhook(payload, repos),
      // ... other config
    };

    const transport = new LinearEventTransport(transportConfig);

    this.linearEventTransports.set(repo.id, transport);
    await transport.connect();
  }
}
```

### Webhook Handling:
```typescript
async handleWebhook(payload: LinearWebhook, repos: RepositoryConfig[]) {
  // ... determine webhook type (issue assigned, comment, etc.)
  // ... create or resume Claude session
}
```

### Approval Workflow:
```typescript
// In Claude runner, when approval needed:
const { promise, url } = this.sharedApplicationServer
  .registerApprovalRequest(sessionId);

// Post approval URL to Linear comment
await linearClient.createComment({
  issueId: issueId,
  body: `Approval needed: ${url}`
});

// Wait for approval
const { approved, feedback } = await promise;
if (approved) {
  // Continue session
}
```

---

## ngrok vs Cloudflare Implementation

### ngrok (Default for CLI)
- **Setup**: `SharedApplicationServer.startNgrokTunnel()`
- **Auth**: `ngrokAuthToken` environment variable
- **URL Discovery**: ngrok listener emits `url` event
- **Condition**: Only if `CYRUS_HOST_EXTERNAL !== "true"`
- **Override**: `CYRUS_BASE_URL` set from ngrok URL

### Cloudflare (For Cyrus-Hosted)
- **Setup**: `CloudflareTunnelClient.startTunnel()`
- **Auth**: Token-based (remotely-managed)
- **URL Discovery**: Tunnel emits `url` event
- **Use Case**: When using cyrus-hosted proxy service
- **Port**: Fixed at 3456

---

## Key Design Patterns

### 1. Unified Webhook Server Pattern
- Single HTTP server handles multiple client types
- Clients register handlers dynamically
- Server routes based on detection (header-based)
- Eliminates port conflicts between multiple clients

### 2. External Server Integration
- Clients support `externalWebhookServer` config
- Enables sharing HTTP server across clients
- Each client registers its own handler
- Server manages routing and signature verification

### 3. Direct Webhook Pattern
- LinearEventTransport: Linear SDK HMAC signature verification
- Supports standalone OR shared server mode

### 4. Promise-based OAuth
- OAuth flow returns Promise<credentials>
- Allows async/await style usage
- Timeout mechanism prevents indefinite hangs
- Supports multiple simultaneous flows (per flow ID)

### 5. Handler Registry
- Token-keyed handler storage
- Multiple handlers can coexist
- Sequential handler attempts until success
- Unregister on disconnect

---

## Dependencies and Imports

### SharedApplicationServer Dependencies
```typescript
import { forward } from "@ngrok/ngrok"  // ngrok tunnel
import { DEFAULT_PROXY_URL, type OAuthCallbackHandler } from "cyrus-core"
// Node built-ins: http, crypto, url
```

### LinearEventTransport Dependencies
```typescript
import { LinearWebhookClient } from "@linear/sdk/webhooks"
import type { LinearEventTransportConfig } from "./types"
// Node built-ins: events, http
```

### CloudflareTunnelClient Dependencies
```typescript
import { Tunnel, bin, install } from "cloudflared"
import { type LinearWebhookPayload } from "@linear/sdk/webhooks"
// Node built-ins: child_process, events, fs, http
```

### EdgeWorker Dependencies
```typescript
import { LinearEventTransport } from "cyrus-linear-event-transport"
import { SharedApplicationServer } from "./SharedApplicationServer"
import { AgentSessionManager } from "./AgentSessionManager"
import { ProcedureRouter } from "./procedures"
// Plus Linear SDK, Claude Runner, etc.
```

---

## Configuration Environment Variables

### Shared Application Server
- `CYRUS_SERVER_PORT` - HTTP server port (default 3456)
- `CYRUS_BASE_URL` - Override base URL (set by ngrok)
- `CYRUS_HOST_EXTERNAL` - Use external host (disables ngrok)
- `LINEAR_CLIENT_ID` - For direct Linear OAuth
- `LINEAR_CLIENT_SECRET` - For direct Linear OAuth

### Webhook Configuration
- `LINEAR_WEBHOOK_SECRET` - For LinearEventTransport HMAC verification

### OAuth Configuration
- `PROXY_URL` - Edge proxy server URL (default: cyrus-proxy.com)

---

## Current State Summary

### What Works
1. ✅ Unified SharedApplicationServer with ngrok tunneling
2. ✅ Webhook handler registration with LinearEventTransport
3. ✅ Linear SDK HMAC signature verification
4. ✅ OAuth flow (both proxy and direct)
5. ✅ Approval request handling
6. ✅ CloudflareTunnelClient for remote deployment

### Integration Points
1. **EdgeWorker creates** SharedApplicationServer
2. **EdgeWorker passes** SharedApplicationServer to transport configs
3. **Transports register** handlers with SharedApplicationServer
4. **SharedApplicationServer routes** webhooks to correct transport
5. **Transports emit** events that EdgeWorker handles

### Design Benefits
1. **Scalability**: Single port for all webhooks
2. **Simplicity**: Transports don't manage HTTP servers
3. **Robustness**: Centralized error handling and logging
4. **Testability**: Can mock SharedApplicationServer in tests
5. **Security**: HMAC signature verification using Linear SDK

