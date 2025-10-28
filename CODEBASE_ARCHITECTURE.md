# Cyrus Codebase Architecture Analysis

## Executive Summary

The Cyrus codebase is a TypeScript/JavaScript monorepo organized with a clear separation of concerns:
- **Apps**: CLI (main application) and Proxy Worker (OAuth/webhook handling)
- **Packages**: Shared libraries for edge workers, clients, and utilities

The architecture has evolved toward a **unified webhook handling pattern** where:
1. A single `SharedApplicationServer` manages HTTP webhooks and OAuth flows
2. Multiple `NdjsonClient` and `LinearWebhookClient` instances register handlers with the shared server
3. All clients use a common tunnel infrastructure (ngrok or Cloudflare)

---

## Package Structure

```
cyrus-workspaces/
├── apps/
│   ├── cli/               # Main CLI application
│   └── proxy-worker/      # OAuth/webhook proxy (cloud-based)
│
└── packages/
    ├── cloudflare-tunnel-client/  # Cloudflare tunnel implementation
    ├── linear-webhook-client/     # Linear webhook direct integration
    ├── ndjson-client/             # Proxy-based webhook client
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
- **Dual Webhook Handling**:
  - Proxy-style webhooks (HMAC signature verification)
  - Direct Linear webhooks (Linear SDK signature verification)

**Registered Handlers**:

1. **Webhook Handler** (`/webhook` - POST)
   - Routes incoming POST requests to registered webhook handlers
   - Supports two registration styles:
     - **Proxy-style**: `registerWebhookHandler(token, secret, handler)`
     - **Direct-style**: `registerWebhookHandler(token, handler)`
   - Auto-detects webhook type based on headers
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
- `webhookHandlers`: Proxy-style handlers (token -> {secret, handler})
- `linearWebhookHandlers`: Direct-style handlers (token -> handler)
- `oauthCallbacks`: Pending OAuth flows (flowId -> {resolve, reject})
- `oauthStates`: CSRF tokens for direct OAuth
- `pendingApprovals`: User approval requests (sessionId -> callback)

---

### 2. NdjsonClient Package
**Location**: `/packages/ndjson-client/`

**Purpose**: 
Client for communicating with Cyrus proxy server via NDJSON streaming protocol.

**Entry Point**: `NdjsonClient.ts`
```typescript
export class NdjsonClient extends EventEmitter {
  private transport: WebhookTransport;
  
  async connect(): Promise<void>
  async sendStatus(update: StatusUpdate): Promise<void>
  disconnect(): void
  isConnected(): boolean
}
```

**Key Events**:
- `connect`: Connected to proxy
- `disconnect`: Connection lost
- `event`: New NDJSON event received
- `webhook`: Webhook data (legacy)
- `heartbeat`: Proxy heartbeat signal
- `error`: Connection error

**Transport Layer** (`WebhookTransport.ts`):

1. **Registration Phase**:
   ```
   1. POST /edge/register to proxy
   2. Receives webhookSecret from proxy
   3. Registers with SharedApplicationServer
   4. Handler signature: (body, signature, timestamp) => boolean
   ```

2. **External Server Integration**:
   - If `useExternalWebhookServer=true` and `externalWebhookServer` provided:
     - Calls `externalWebhookServer.registerWebhookHandler(token, secret, handler)`
     - Handler verifies HMAC signature using `webhookSecret`
     - Returns true/false based on signature validity

3. **Webhook Handling**:
   - Receives webhooks via SharedApplicationServer
   - Verifies HMAC-SHA256 signature: `sha256=${hmac(secret, timestamp.body)}`
   - Parses as `EdgeEvent` and emits

**Configuration**:
```typescript
interface NdjsonClientConfig {
  proxyUrl: string                    // Proxy URL for registration
  token: string                       // Linear token (auth header)
  transport: "webhook"               // Only type supported
  webhookPort?: number               // Port for webhook server (3000)
  webhookHost?: string               // Host for webhook server
  webhookBaseUrl?: string            // Alternative full URL
  webhookPath?: string               // Path for webhook endpoint
  externalWebhookServer?: any        // SharedApplicationServer instance
  useExternalWebhookServer?: boolean // Use SharedApplicationServer
  onEvent?: (event: EdgeEvent) => void
  onConnect/Disconnect/Error?: callback
}
```

---

### 3. LinearWebhookClient Package
**Location**: `/packages/linear-webhook-client/`

**Purpose**:
Client for receiving webhooks directly from Linear (Direct Webhooks mode).

**Entry Point**: `LinearWebhookClient.ts`
```typescript
export class LinearWebhookClient extends EventEmitter {
  private transport: WebhookTransport;
  
  async connect(): Promise<void>
  async sendStatus(update: StatusUpdate): Promise<void>
  disconnect(): void
  isConnected(): boolean
}
```

**Key Events**:
- `connect`: Connected to webhook system
- `disconnect`: Connection lost
- `webhook`: Linear webhook payload
- `error`: Connection error

**Transport Layer** (`WebhookTransport.ts`):

1. **Uses Linear SDK Webhook Client**:
   - Creates `LinearWebhookClient` from `@linear/sdk/webhooks`
   - Gets handler via `webhookClient.createHandler()`
   - Handler validates `linear-signature` header

2. **Two Operational Modes**:

   **Mode A: Standalone HTTP Server**
   - Creates own HTTP server on configured port
   - Linear webhooks POST to this server
   - Linear SDK verifies signature automatically

   **Mode B: External Webhook Server**
   - Registers handler with SharedApplicationServer
   - `registerWebhookHandler(token, async (req, res) => webhookHandler(req, res))`
   - Signature verification done by Linear SDK inside handler

3. **Direct Registration Pattern**:
   - SharedApplicationServer detects `linear-signature` header
   - Routes to direct handler (req, res) style
   - Handler manages own response

**Configuration**:
```typescript
interface LinearWebhookClientConfig {
  proxyUrl: string                    // For status updates
  token: string                       // Linear token
  transport: "webhook"               // Only type supported
  webhookPort?: number
  webhookHost?: string
  webhookBaseUrl?: string
  webhookPath?: string
  externalWebhookServer?: any        // SharedApplicationServer
  useExternalWebhookServer?: boolean
  onWebhook?: (payload: LinearWebhookPayload) => void
  onConnect/Disconnect/Error?: callback
}
```

---

### 4. CloudflareTunnelClient Package
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

### 5. EdgeWorker.ts
**Location**: `/packages/edge-worker/src/EdgeWorker.ts`

**Purpose**:
Orchestrates the entire edge worker, managing webhooks, Claude sessions, and Linear integration.

**Key Components**:

1. **Webhook Client Management**:
   ```typescript
   private ndjsonClients: Map<string, NdjsonClient | LinearWebhookClient>
   ```
   - One client per Linear token
   - Clients share the `SharedApplicationServer`
   - Each repository can have different tokens

2. **Webhook Registration Flow**:

   For each Linear token:
   ```
   1. Create NdjsonClient or LinearWebhookClient
   2. Set useExternalWebhookServer: true
   3. Pass this.sharedApplicationServer as externalWebhookServer
   4. On connect, client calls:
      - registerWebhook() with proxy (gets webhookSecret)
      - registerWithExternalServer() with SharedApplicationServer
      - SharedApplicationServer.registerWebhookHandler(token, secret, handler)
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
   const clientConfig = {
     proxyUrl: this.config.proxyUrl,
     token: token,
     transport: "webhook" as const,
     // CRITICAL: Use shared application server
     useExternalWebhookServer: true,
     externalWebhookServer: this.sharedApplicationServer,
     webhookPort: serverPort,
     webhookPath: "/webhook",
     webhookHost: serverHost,
     onConnect: () => this.handleConnect(repoId, repos),
     onDisconnect: (reason) => this.handleDisconnect(repoId, repos, reason),
     onError: (error) => this.handleError(error),
   };
   
   const client = useLinearDirectWebhooks
     ? new LinearWebhookClient({...clientConfig, onWebhook: handler})
     : new NdjsonClient(clientConfig);
   ```

5. **Webhook Handling**:
   - NdjsonClient: `client.on("webhook", (data) => ...)`
   - LinearWebhookClient: `onWebhook` callback in config
   - Both route to `this.handleWebhook(payload, repos)`

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
         [Direct: via Linear]  [Proxy: via Edge]  [Cloudflare: via Tunnel]
                │                   │                  │
                ▼                   ▼                  ▼
        ┌──────────────┐     ┌────────────┐    ┌─────────────────┐
        │ Direct Link  │     │   Proxy    │    │ Cloudflare      │
        │ (linear-sig) │     │ (HMAC-SHA) │    │ Tunnel          │
        └──────┬───────┘     └─────┬──────┘    └────────┬────────┘
               │                   │                    │
               └───────────────────┼────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ SharedApplicationServer:   │
                    │ /webhook (POST)            │
                    │                            │
                    │ - Detects webhook type    │
                    │ - Routes to handler       │
                    │ - Verifies signature      │
                    └──────────────┬─────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌───────────────────┐  ┌───────────────────┐  ┌──────────────┐
    │ NdjsonClient      │  │ LinearWebhook     │  │ EdgeWorker   │
    │ registerHandler   │  │ Client            │  │ handleWebhook│
    │ (token, secret,   │  │ registerHandler   │  │              │
    │  fn)              │  │ (token, fn)       │  │ Processes    │
    │                   │  │                   │  │ Linear event │
    │ Verifies HMAC     │  │ Linear SDK        │  │              │
    │                   │  │ verifies sig      │  │ Creates      │
    │ Emits webhook     │  │                   │  │ Claude       │
    │ event            │  │ Emits webhook     │  │ session      │
    └─────────┬─────────┘  │ event            │  └──────────────┘
              │            └────────┬────────┘
              │                     │
              └─────────┬───────────┘
                        │
            ┌──────────▼──────────┐
            │ EdgeWorker.       │
            │ handleWebhook()    │
            │                    │
            │ - Parse Linear     │
            │   event            │
            │ - Create issue or  │
            │   start session    │
            │ - Post to Linear   │
            └────────────────────┘
```

---

## Handler Registration Signatures

### SharedApplicationServer Signatures

**Proxy-style Handler** (used by NdjsonClient):
```typescript
registerWebhookHandler(
  token: string,
  secret: string,
  handler: (body: string, signature: string, timestamp?: string) => boolean
): void
```
- **Return**: `true` if signature verified and handled, `false` otherwise
- **Usage**: Called sequentially until one returns true
- **Verification**: Handler must verify HMAC-SHA256 signature

**Direct-style Handler** (used by LinearWebhookClient):
```typescript
registerWebhookHandler(
  token: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
): void
```
- **Return**: Promise (handler manages response)
- **Usage**: Called if `linear-signature` header detected
- **Verification**: Handler (via Linear SDK) handles signature verification

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
async setupClientsForTokens() {
  for (const token of uniqueTokens) {
    const repos = this.getRepositoriesForToken(token);
    
    const clientConfig = {
      proxyUrl: this.config.proxyUrl,
      token: token,
      transport: "webhook",
      useExternalWebhookServer: true,
      externalWebhookServer: this.sharedApplicationServer,  // ← KEY
      webhookPort: serverPort,
      webhookPath: "/webhook",
      webhookHost: serverHost,
      // ... other config
    };
    
    // Choose client type
    const client = useLinearDirectWebhooks
      ? new LinearWebhookClient({...clientConfig, onWebhook: handler})
      : new NdjsonClient(clientConfig);
    
    this.ndjsonClients.set(repo.id, client);
    await client.connect();
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

### 3. Dual Transport Pattern
- NdjsonClient: HMAC-SHA256 signature verification
- LinearWebhookClient: Linear SDK signature verification
- Both support standalone OR shared server mode

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

### NdjsonClient Dependencies
```typescript
import { WebhookTransport } from "./transports/WebhookTransport"
import type { NdjsonClientConfig, NdjsonClientEvents } from "./types"
// Node built-ins: events
```

### LinearWebhookClient Dependencies
```typescript
import { LinearWebhookClient as LinearSdkWebhookClient } from "@linear/sdk/webhooks"
import { WebhookTransport } from "./transports/WebhookTransport"
// Node built-ins: events
```

### CloudflareTunnelClient Dependencies
```typescript
import { Tunnel, bin, install } from "cloudflared"
import { type LinearWebhookPayload } from "@linear/sdk/webhooks"
// Node built-ins: child_process, events, fs, http
```

### EdgeWorker Dependencies
```typescript
import { LinearWebhookClient } from "cyrus-linear-webhook-client"
import { NdjsonClient } from "cyrus-ndjson-client"
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
- `LINEAR_WEBHOOK_SECRET` - For LinearWebhookClient
- `LINEAR_DIRECT_WEBHOOKS` - Use direct webhooks (LinearWebhookClient)

### OAuth Configuration
- `PROXY_URL` - Edge proxy server URL (default: cyrus-proxy.com)

---

## Current State Summary

### What Works
1. ✅ Unified SharedApplicationServer with ngrok tunneling
2. ✅ Webhook handler registration (both styles)
3. ✅ NdjsonClient with HMAC verification
4. ✅ LinearWebhookClient with Linear SDK verification
5. ✅ OAuth flow (both proxy and direct)
6. ✅ Approval request handling
7. ✅ CloudflareTunnelClient for remote deployment

### Integration Points
1. **EdgeWorker creates** SharedApplicationServer
2. **EdgeWorker passes** SharedApplicationServer to client configs
3. **Clients register** handlers with SharedApplicationServer
4. **SharedApplicationServer routes** webhooks to correct client
5. **Clients emit** events that EdgeWorker handles

### Design Benefits
1. **Scalability**: Single port for all webhooks
2. **Flexibility**: Support multiple client types simultaneously
3. **Simplicity**: Clients don't manage HTTP servers
4. **Robustness**: Centralized error handling and logging
5. **Testability**: Can mock SharedApplicationServer in tests

