# CRITICAL ISSUES FOUND - Tunnel Client Implementation

## Executive Summary

After extensive review of CYHOST-252 and PR #204, I found **MULTIPLE CRITICAL MISMATCHES** between the cyrus-hosted application and the tunnel client implementation. The current CYPACK-198 implementation will **NOT WORK** with the actual cyrus-hosted system.

## Critical Issue #1: Authentication API Mismatch ⚠️⚠️⚠️

### Current (WRONG) Implementation
**File**: `packages/cloudflare-tunnel-client/src/SubscriptionValidator.ts`

```typescript
// ❌ WRONG - This endpoint doesn't exist in cyrus-hosted
const SUBSCRIPTION_API_URL = "https://www.atcyrus.com/api/subscription-status";
static async validate(customerId: string): Promise<SubscriptionStatusResponse> {
    const url = `${SUBSCRIPTION_API_URL}?customerId=${encodeURIComponent(customerId)}`;
    // ...
}
```

### Actual cyrus-hosted Implementation
**File**: `apps/app/src/app/api/config/route.ts`

```typescript
// ✅ CORRECT - This is the actual endpoint
// GET /api/config?auth_key=xxx
// OR Authorization: Bearer <auth_key>

// Returns:
{
  success: true,
  config: {
    cloudflareToken: string,  // Tunnel token
    apiKey: string            // Decrypted cyrus API key
  }
}
```

### Impact
- **COMPLETE FAILURE** - The tunnel client cannot authenticate at all
- Uses wrong API endpoint that doesn't exist
- Uses wrong parameter (`customerId` vs `auth_key`)
- Expects wrong response structure

### Required Fix
The tunnel client needs to:
1. Accept `authKey` parameter (NOT `customerId`)
2. Call `/api/config` endpoint (NOT `/api/subscription-status`)
3. Parse response with `config.cloudflareToken` and `config.apiKey` fields

---

## Critical Issue #2: Repository Endpoint Mismatch ⚠️⚠️

### Current Implementation
**File**: `packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts:252`

```typescript
// ❌ WRONG - Missing /update/ in path
} else if (url === "/api/repository" && req.method === "POST") {
```

### Actual cyrus-hosted Call
**File**: `apps/app/src/lib/cloudflare/tunnel-config-updater.ts:178`

```typescript
// ✅ CORRECT - Includes /update/ in path
const repoUrl = `https://${tunnelDomain}/api/update/repository`;
```

### Payload Format
**cyrus-hosted sends**:
```typescript
{
  repository_url: string,   // GitHub URL
  repository_name: string   // Repository name
}
```

**tunnel client expects** (packages/cloudflare-tunnel-client/src/types.ts:30):
```typescript
interface RepositoryPayload {
  repoUrl: string;     // ❌ Different field name!
  name?: string;       // ❌ Different field name and optional!
}
```

### Impact
- Repository cloning endpoint returns 404
- Field name mismatches cause failures

### Required Fix
1. Change endpoint from `/api/repository` to `/api/update/repository`
2. Update `RepositoryPayload` to match cyrus-hosted:
   - `repoUrl` → `repository_url`
   - `name` → `repository_name` (required, not optional)

---

## Critical Issue #3: Environment Variables Payload Format

### Current Implementation
The tunnel client partially supports this but documentation is incomplete.

**File**: `packages/cloudflare-tunnel-client/src/types.ts:66-71`

```typescript
export interface CyrusEnvPayload {
  variables?: Record<string, string>;  // ✅ CORRECT
  ANTHROPIC_API_KEY?: string;
  restartCyrus?: boolean;
  backupEnv?: boolean;
  [key: string]: string | boolean | Record<string, string> | undefined;
}
```

### cyrus-hosted Sends
**File**: `apps/app/src/lib/cloudflare/tunnel-config-updater.ts:150-154`

```typescript
{
  variables: {
    CYRUS_SERVER_PORT: "3000",
    CYRUS_HOST_EXTERNAL: "true",
    LINEAR_DIRECT_WEBHOOKS: "true",
    CLAUDE_CODE_OAUTH_TOKEN?: string,  // OR
    ANTHROPIC_API_KEY?: string
  },
  restartCyrus: true,
  backupEnv: true
}
```

### Status
✅ **FIXED** - The handler now correctly processes the `variables` object (cyrusEnv.ts:27-33)

---

## Critical Issue #4: Authentication Header Usage

### cyrus-hosted Always Uses Auth Key
**File**: `apps/app/src/lib/cloudflare/tunnel-config-updater.ts:119, 148, 184`

```typescript
headers: {
  Authorization: `Bearer ${team.cyrus_auth_key}`
}
```

### tunnel client Verification
**File**: `packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts:302`

```typescript
private verifyAuth(authHeader: string | undefined): boolean {
  if (!authHeader || !this.apiKey) return false;
  const expectedAuth = `Bearer ${this.apiKey}`;
  return authHeader === expectedAuth;
}
```

### Issue
The `apiKey` stored in the tunnel client comes from the WRONG source:
- Should come from `/api/config` endpoint's `config.apiKey` response
- Currently comes from non-existent `/api/subscription-status` endpoint

### Status
✅ **PATTERN CORRECT** - Once authentication API is fixed, this will work

---

## Authentication Flow (Actual Implementation)

### Step 1: User Onboarding (cyrus-hosted UI)
1. User completes checkout → Plan type stored in database
2. cyrus-hosted creates Cloudflare tunnel automatically
3. cyrus-hosted generates `cyrus_auth_key` (43-char URL-safe base64)
4. User sees auth key in UI at `/onboarding/auth-cyrus`

### Step 2: CLI Authentication
1. User runs: `cyrus auth <auth_key>`
2. CLI should call: `GET https://www.atcyrus.com/api/config?auth_key=xxx`
   - OR: `GET https://www.atcyrus.com/api/config` with `Authorization: Bearer <auth_key>`
3. API returns:
   ```json
   {
     "success": true,
     "config": {
       "cloudflareToken": "ey...",
       "apiKey": "cyrus_abc123..."
     }
   }
   ```
4. CLI uses `cloudflareToken` to start tunnel
5. CLI uses `apiKey` to authenticate incoming requests from cyrus-hosted

### Step 3: Configuration Delivery
1. cyrus-hosted sends config to tunnel:
   - POST `https://{tunnel_domain}/api/update/cyrus-config`
   - POST `https://{tunnel_domain}/api/update/cyrus-env`
   - POST `https://{tunnel_domain}/api/update/repository`
2. All requests include: `Authorization: Bearer <cyrus_auth_key>`
3. Tunnel client validates against stored `apiKey`

---

## Complete API Interaction Matrix

### From cyrus-hosted → tunnel client

| Endpoint | Method | Auth Header | Payload | Status |
|----------|--------|-------------|---------|--------|
| `/api/update/cyrus-config` | POST | `Bearer <cyrus_auth_key>` | CyrusConfigPayload | ✅ FIXED |
| `/api/update/cyrus-env` | POST | `Bearer <cyrus_auth_key>` | CyrusEnvPayload | ✅ FIXED |
| `/api/update/repository` | POST | `Bearer <cyrus_auth_key>` | RepositoryPayload | ❌ WRONG PATH |
| `/webhook` | POST | `Bearer <cyrus_auth_key>` + Linear signature | LinearWebhookPayload | ✅ CORRECT |

### From tunnel client → cyrus-hosted

| Endpoint | Method | Auth | Payload | Status |
|----------|--------|------|---------|--------|
| `/api/config` | GET | `?auth_key=xxx` OR `Bearer <auth_key>` | N/A | ❌ NOT IMPLEMENTED |

---

## Other Endpoints in Tunnel Client

These endpoints exist in the tunnel client but are NOT called by cyrus-hosted:

| Endpoint | Purpose | Called By |
|----------|---------|-----------|
| `/api/test-mcp` | Test MCP server | Future feature |
| `/api/configure-mcp` | Configure MCP servers | Future feature |

**Note**: These are placeholder endpoints for future features and are not currently used.

---

## Action Plan - CRITICAL FIXES REQUIRED

### Priority 1: Fix Authentication (BLOCKS EVERYTHING)

1. **Delete/Replace** `SubscriptionValidator.ts`
2. **Create** `ConfigApiClient.ts`:
   ```typescript
   class ConfigApiClient {
     static async getConfig(authKey: string): Promise<{
       cloudflareToken: string;
       apiKey: string;
     }> {
       const url = `https://www.atcyrus.com/api/config?auth_key=${encodeURIComponent(authKey)}`;
       const response = await fetch(url);
       const data = await response.json();
       return data.config; // { cloudflareToken, apiKey }
     }
   }
   ```
3. **Update** `CloudflareTunnelClient.authenticate()` to use `authKey` parameter
4. **Update** type definitions to use `authKey` instead of `customerId`

### Priority 2: Fix Repository Endpoint

1. **Change** endpoint path in `CloudflareTunnelClient.ts`:
   ```typescript
   // From:
   } else if (url === "/api/repository" && req.method === "POST") {

   // To:
   } else if (url === "/api/update/repository" && req.method === "POST") {
   ```

2. **Update** `RepositoryPayload` type in `types.ts`:
   ```typescript
   export interface RepositoryPayload {
     repository_url: string;  // Changed from repoUrl
     repository_name: string; // Changed from name?, made required
   }
   ```

3. **Update** handler in `repository.ts` to use new field names

### Priority 3: Update Documentation

1. Update `README.md` with correct authentication flow
2. Document the `/api/config` endpoint
3. Document auth key vs customer ID distinction
4. Add examples with actual API calls

### Priority 4: Integration Testing

Once fixes are deployed:
1. Test full authentication flow from UI to CLI
2. Test config delivery from cyrus-hosted to tunnel
3. Test repository cloning
4. Test Linear webhook forwarding

---

## Estimated Impact

### Current State
- ❌ **0% functional** - Authentication completely broken
- ❌ Repository endpoint returns 404
- ✅ Config/env endpoints work (after CYPACK-198 fix)
- ✅ Webhook endpoint works

### After Priority 1 Fix
- ✅ **40% functional** - Authentication works
- ❌ Repository still broken
- ✅ Config/env work
- ✅ Webhooks work

### After Priority 1 + 2 Fixes
- ✅ **100% functional** - Full integration working

---

## Testing Checklist

- [ ] Auth key can be obtained from UI
- [ ] CLI can call `/api/config` with auth key
- [ ] CLI receives correct `cloudflareToken` and `apiKey`
- [ ] Tunnel starts with correct token
- [ ] Config updates reach tunnel at `/api/update/cyrus-config`
- [ ] Env updates reach tunnel at `/api/update/cyrus-env`
- [ ] Repository cloning works at `/api/update/repository`
- [ ] Webhook forwarding works at `/webhook`
- [ ] Auth key validation rejects invalid keys
- [ ] Auth key validation accepts valid keys

---

## References

### cyrus-hosted Files (CYHOST-252)
- `apps/app/src/app/api/config/route.ts` - Config delivery API
- `apps/app/src/lib/cloudflare/tunnel-config-updater.ts` - Config update sender
- `apps/app/src/lib/cloudflare/tunnel-service.ts` - Tunnel provisioning
- `apps/app/src/app/actions/cyrus.ts` - Auth key display

### tunnel client Files (CYPACK-198)
- `packages/cloudflare-tunnel-client/src/SubscriptionValidator.ts` - **NEEDS REPLACEMENT**
- `packages/cloudflare-tunnel-client/src/CloudflareTunnelClient.ts` - Main client
- `packages/cloudflare-tunnel-client/src/types.ts` - Type definitions
- `packages/cloudflare-tunnel-client/src/handlers/` - Request handlers

---

**CONCLUSION**: The current tunnel client implementation has CRITICAL authentication and endpoint mismatches. These must be fixed before ANY integration testing can succeed.
