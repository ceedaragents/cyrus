# CYPACK-198 Analysis: Tunnel Client Refactoring

## Overview
This document analyzes the cyrus-hosted application (CYHOST-252) and identifies necessary refactoring for the tunnel client implementation (CYPACK-198).

## Executive Summary

The current tunnel client implementation is **close to correct** but has **critical endpoint path mismatches** that will prevent it from working with the cyrus-hosted application.

### Critical Issues Found
1. ❌ **Endpoint paths don't match** - Client expects `/api/cyrus-config` but host sends to `/api/update/cyrus-config`
2. ⚠️ **Missing restart/backup flags** - Host sends `restartCyrus` and `backupConfig` options
3. ✅ **Authentication pattern matches** - Both use Bearer tokens
4. ✅ **Payload structures compatible** - Types align with what host sends
5. ✅ **Architecture correct** - Cloudflare tunnel + HTTP server is the right approach

## Architecture Comparison

### CYHOST-252 (Application/Host Side)
```
┌──────────────────────────────────────┐
│  Cyrus Hosted Application (Bun)     │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  Tunnel Service                │ │
│  │  - Provisions tunnels          │ │
│  │  - Generates cyrus_auth_key    │ │
│  │  - Generates cyrus_api_key     │ │
│  └────────────────────────────────┘ │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  Tunnel Config Updater         │ │
│  │  POST /api/update/cyrus-config │ │
│  │  POST /api/update/cyrus-env    │ │
│  └────────────────────────────────┘ │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  Webhook Handlers              │ │
│  │  - Linear: /api/linear/webhook │ │
│  │  - GitHub: /api/github/webhook │ │
│  └────────────────────────────────┘ │
└──────────────────────────────────────┘
           │
           │ HTTPS over Cloudflare Tunnel
           ▼
┌──────────────────────────────────────┐
│  {tunnel_id}.cfargotunnel.com       │
└──────────────────────────────────────┘
```

### CYPACK-198 (Client Side - Current)
```
┌──────────────────────────────────────┐
│  Cyrus CLI (Node.js)                 │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  CloudflareTunnelClient        │ │
│  │  - Spawns cloudflared process  │ │
│  │  - Runs HTTP server            │ │
│  │  - Authenticates requests      │ │
│  └────────────────────────────────┘ │
│                                      │
│  Current Endpoints:                  │
│  ❌ POST /api/cyrus-config           │
│  ❌ POST /api/cyrus-env              │
│  ✅ POST /webhook                    │
│  ✅ POST /api/repository             │
│  ✅ POST /api/test-mcp               │
│  ✅ POST /api/configure-mcp          │
└──────────────────────────────────────┘
```

## Detailed Findings

### 1. Endpoint Path Mismatch (CRITICAL)

**Problem**: The hosted application and client have different endpoint paths.

**Host sends to**:
- `/api/update/cyrus-config` - tunnel-config-updater.ts:112
- `/api/update/cyrus-env` - tunnel-config-updater.ts:141

**Client listens on**:
- `/api/cyrus-config` - CloudflareTunnelClient.ts:239
- `/api/cyrus-env` - CloudflareTunnelClient.ts:247

**Impact**: Configuration updates from the hosted app will return 404 errors.

**Solution**: Update client endpoints to match host:
```typescript
// Change from:
if (url === "/api/cyrus-config" && req.method === "POST")
if (url === "/api/cyrus-env" && req.method === "POST")

// To:
if (url === "/api/update/cyrus-config" && req.method === "POST")
if (url === "/api/update/cyrus-env" && req.method === "POST")
```

### 2. Missing Restart/Backup Flags

**Problem**: Host sends additional control flags that client ignores.

**Host sends** (tunnel-config-updater.ts:122-124):
```typescript
body: JSON.stringify({
  ...config,
  restartCyrus: true,
  backupConfig: true,
})
```

**Client receives**: Parses as `CyrusConfigPayload` which doesn't include these fields.

**Impact**:
- Configuration changes won't trigger Cyrus restart
- No backup of previous config is made

**Solution**:
1. Add fields to `CyrusConfigPayload` type
2. Implement backup logic in handlers
3. Implement Cyrus restart logic (needs integration with CLI)

### 3. Authentication Flow

**Status**: ✅ Compatible (with minor alignment needed)

**Host expects** (tunnel-config-updater.ts:119):
```typescript
Authorization: `Bearer ${team.cyrus_auth_key}`
```

**Client validates** (CloudflareTunnelClient.ts:302):
```typescript
const expectedAuth = `Bearer ${this.apiKey}`;
```

**Analysis**:
- Pattern matches: Both use Bearer token
- Key source differs: Host uses `cyrus_auth_key` from database, client uses `apiKey` from subscription API
- These should be the **same key** - the subscription API should return the `cyrus_auth_key`

**Verification needed**: Ensure subscription API returns the correct `cyrus_auth_key`.

### 4. Config Payload Structure

**Status**: ✅ Mostly compatible

**Host builds** (see cyrus-config/builder.ts reference):
```typescript
const config = buildCyrusConfig(repositories, teamData);
```

**Client expects**:
```typescript
interface CyrusConfigPayload {
  repositories: Array<{
    id: string;
    name: string;
    repositoryPath: string;
    baseBranch: string;
    linearWorkspaceId?: string;
    linearToken?: string;
    workspaceBaseDir?: string;
    isActive?: boolean;
    allowedTools?: string[];
    mcpConfigPath?: string[];
    teamKeys?: string[];
    labelPrompts?: Record<string, string[]>;
  }>;
  disallowedTools?: string[];
  ngrokAuthToken?: string;
  stripeCustomerId?: string;
  defaultModel?: string;
  defaultFallbackModel?: string;
  global_setup_script?: string;
}
```

**Analysis**: Structure appears compatible. Need to verify `buildCyrusConfig()` output matches this interface.

### 5. Environment Variables Payload

**Status**: ✅ Compatible

**Host sends** (tunnel-config-updater.ts:74-95):
```typescript
const envVars: Record<string, string> = {
  CYRUS_SERVER_PORT: "3000",
  CYRUS_HOST_EXTERNAL: "true",
  LINEAR_DIRECT_WEBHOOKS: "true",
};

if (team.claude_key_type === "claude_code") {
  envVars.CLAUDE_CODE_OAUTH_TOKEN = claudeResult.apiKey;
} else if (team.claude_key_type === "anthropic_api") {
  envVars.ANTHROPIC_API_KEY = claudeResult.apiKey;
}
```

**Client expects** (types.ts:64-67):
```typescript
export interface CyrusEnvPayload {
  ANTHROPIC_API_KEY?: string;
  [key: string]: string | undefined;
}
```

**Analysis**:
- ✅ Client accepts any key-value pairs
- ✅ ANTHROPIC_API_KEY is included
- ✅ Additional env vars (CLAUDE_CODE_OAUTH_TOKEN, etc.) will work

### 6. Webhook Forwarding

**Status**: ✅ Compatible

**Host forwards** (linear/webhook/route.ts:180-201):
```typescript
const dropletUrl = team.droplet_domain
  ? `https://${team.droplet_domain}/webhook`
  : `http://${team.droplet_ip}:3000/webhook`;

await fetch(dropletUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    [LINEAR_WEBHOOK_SIGNATURE_HEADER]: signature,
    // ...
  },
  body: rawBodyText,
})
```

**Client receives** (CloudflareTunnelClient.ts:264-267):
```typescript
else if (url === "/webhook" && req.method === "POST") {
  this.emit("webhook", parsedBody as LinearWebhookPayload);
  response = { success: true, message: "Webhook received" };
}
```

**Analysis**:
- ✅ Path matches (`/webhook`)
- ✅ Method matches (POST)
- ⚠️ Client doesn't verify Linear webhook signature - security risk!

**Recommendation**: Add Linear webhook signature verification in client.

### 7. Tunnel Setup Flow

**Status**: ✅ Correct approach

**Host provisions** (tunnel-service.ts:65-328):
1. Generates `cyrus_auth_key` (URL-safe base64, 32 bytes)
2. Creates tunnel via Cloudflare API
3. Stores `cloudflare_tunnel_id`, `cloudflare_tunnel_token`, `tunnel_domain`
4. Generates and encrypts `cyrus_api_key`
5. Polls tunnel health until active

**Client connects** (CloudflareTunnelClient.ts:64-158):
1. Authenticates with subscription API
2. Receives `cloudflareToken` and `apiKey`
3. Spawns `cloudflared` with token
4. Starts HTTP server
5. Emits `ready` event with tunnel URL

**Analysis**: Flow is correct, but needs verification:
- Is `cloudflareToken` from subscription API the same as `cloudflare_tunnel_token`?
- Is `apiKey` from subscription API the same as decrypted `cyrus_api_key` or `cyrus_auth_key`?

## Implementation Recommendations

### Phase 1: Critical Fixes (Required for MVP)

1. **Update endpoint paths** in `CloudflareTunnelClient.ts`:
   - Change `/api/cyrus-config` → `/api/update/cyrus-config`
   - Change `/api/cyrus-env` → `/api/update/cyrus-env`

2. **Add restart/backup support**:
   - Extend `CyrusConfigPayload` type with `restartCyrus?: boolean` and `backupConfig?: boolean`
   - Implement backup logic in `handleCyrusConfig`
   - Add restart mechanism (emit event for CLI to handle)

3. **Verify authentication flow**:
   - Ensure subscription API returns correct `cyrus_auth_key`
   - Document the key lifecycle

### Phase 2: Security Improvements (Recommended)

1. **Add Linear webhook signature verification**:
   ```typescript
   import { LinearWebhookClient, LINEAR_WEBHOOK_SIGNATURE_HEADER } from '@linear/sdk/webhooks';

   // Verify signature before processing webhook
   const webhookClient = new LinearWebhookClient(webhookSecret);
   const payload = webhookClient.parseData(bodyBuffer, signature);
   ```

2. **Add request timeout handling**
3. **Add retry logic for failed config updates**

### Phase 3: Feature Parity (Nice to Have)

1. **Implement tunnel health monitoring** on client side
2. **Add reconnection logic** if tunnel drops
3. **Add structured logging** matching host side
4. **Add metrics/telemetry** for tunnel status

## Testing Checklist

- [ ] Config update endpoint responds at `/api/update/cyrus-config`
- [ ] Env update endpoint responds at `/api/update/cyrus-env`
- [ ] Webhook forwarding works at `/webhook`
- [ ] Authentication with `cyrus_auth_key` succeeds
- [ ] Config backup is created before updates
- [ ] Cyrus restart is triggered on config change
- [ ] Linear webhook signature is verified
- [ ] Repository cloning works via `/api/repository`
- [ ] MCP configuration works via `/api/configure-mcp`
- [ ] Error responses are properly formatted

## Files to Modify

### High Priority
1. `packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts`
   - Line 239: Update config endpoint path
   - Line 247: Update env endpoint path
   - Line 264: Add webhook signature verification

2. `packages/cloudflare-tunnel-client/src/types.ts`
   - Add `restartCyrus?: boolean` to `CyrusConfigPayload`
   - Add `backupConfig?: boolean` to `CyrusConfigPayload`
   - Add `restartCyrus?: boolean` to `CyrusEnvPayload`
   - Add `backupEnv?: boolean` to `CyrusEnvPayload`

3. `packages/cloudflare-tunnel-client/src/handlers/cyrusConfig.ts`
   - Add backup logic before writing config
   - Emit restart event if `restartCyrus` is true

4. `packages/cloudflare-tunnel-client/src/handlers/cyrusEnv.ts`
   - Add backup logic before writing env
   - Emit restart event if `restartCyrus` is true

### Medium Priority
5. `packages/cloudflare-tunnel-client/package.json`
   - Consider adding `@linear/sdk/webhooks` for signature verification

6. `packages/cloudflare-tunnel-client/README.md`
   - Update endpoint documentation
   - Document restart/backup behavior

## Conclusion

The current implementation is **architecturally sound** but has **critical endpoint mismatches** that must be fixed before integration. The authentication and payload structures are compatible, and the overall tunnel approach matches the hosted application's expectations.

**Priority**: Fix endpoint paths immediately, then add restart/backup support, then improve security.

**Risk Level**: Medium - The endpoint mismatch will cause complete failure, but is easy to fix.

**Estimated Effort**:
- Critical fixes: 2-3 hours
- Security improvements: 2-4 hours
- Feature parity: 4-6 hours
