# Semi-Hosted Onboarding Implementation Plan

**Issue**: CYPACK-188 - Plan approach to add onboarding logic
**Date**: 2025-10-14
**Status**: Planning Complete - Ready for Implementation

## Executive Summary

This document outlines the complete plan for migrating the update-server onboarding logic to the Cyrus npm package to support **semi-hosted customers** who run Cyrus locally on their own machines (instead of on DigitalOcean droplets).

## Table of Contents

1. [Background & Context](#background--context)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Proposed Architecture](#proposed-architecture)
4. [Implementation Plan](#implementation-plan)
5. [Database Changes Required](#database-changes-required)
6. [API Endpoints Specification](#api-endpoints-specification)
7. [Security Considerations](#security-considerations)
8. [Testing Strategy](#testing-strategy)
9. [Rollout Plan](#rollout-plan)
10. [Open Questions](#open-questions)

---

## Background & Context

### Current Situation

**Cyrus-Hosted** (Next.js application at `/Users/agentops/code/cyrus-hosted`):
- Currently ONLY supports fully-hosted deployments
- Automatically provisions DigitalOcean droplets for ALL paying customers
- Uses a Go-based update-server on droplets to receive configuration
- Single Stripe price tier with 7-day free trial

**Update-Server** (Go application at `/Users/agentops/code/cyrus-update-server`):
- Runs on DigitalOcean droplets
- Receives configuration from cyrus-hosted via HTTPS
- Manages GitHub credentials, repository cloning, config updates
- Uses bearer token authentication

**Cyrus CLI** (TypeScript application):
- Currently validates Stripe customer IDs via `/api/subscription-status`
- That endpoint is called but doesn't exist in cyrus-hosted
- Has existing `SharedApplicationServer` for webhooks/OAuth
- No local onboarding server capability

### Goal: Semi-Hosted Onboarding

Enable customers to:
1. Subscribe via Stripe checkout (new semi-hosted plan)
2. Install Cyrus CLI locally on their own computer
3. Use ngrok to expose their local Cyrus instance
4. Complete onboarding by receiving configuration from cyrus-hosted website
5. Run Cyrus locally without needing a DigitalOcean droplet

---

## Current Architecture Analysis

### Update-Server Endpoints (Relevant for Onboarding)

From analysis of `/Users/agentops/code/cyrus-update-server`:

#### ✅ Endpoints to Migrate

1. **POST /api/update/github-credentials**
   - Configures GitHub CLI authentication
   - Uses: `gh auth login --with-token`
   - Payload: `{ token: string }`

2. **POST /api/update/repository**
   - Clones repository to `/home/cyrus/cyrus-app/{repo-name}`
   - Uses: `git clone` via exec
   - Payload: `{ repository_url: string, repository_name?: string }`

3. **POST /api/update/cyrus-config**
   - Updates `/home/cyrus/.cyrus/config.json`
   - Payload: `EdgeConfig` object + `{ restartCyrus?: boolean, backupConfig?: boolean }`

4. **POST /api/update/cyrus-env**
   - Updates `/home/cyrus/cyrus-app/.env`
   - Payload: `{ variables: Record<string, string>, restartCyrus?: boolean, backupEnv?: boolean }`

5. **GET /health**
   - Health check endpoint
   - Returns: `{ status: string, version: string }`

#### ❌ Endpoints NOT Needed (Per Requirements)

- `/api/update/configure-mcp` - MCP configuration (excluded)
- `/api/update/test-mcp` - MCP testing (excluded)
- `/api/update/repository` DELETE - Repository deletion (not onboarding)
- `/api/repositories` GET - List repositories (not onboarding)

### Cyrus-Hosted Current Flow

From analysis of `/Users/agentops/code/cyrus-hosted`:

**Onboarding Steps**:
1. GitHub Authentication (OAuth)
2. **Stripe Checkout** → Triggers droplet provisioning
3. GitHub App Installation
4. Linear Connection (OAuth)
5. Claude API Configuration
6. Completed

**Post-Onboarding Configuration**:
- After onboarding, dashboard calls `sendOnboardingConfigToDroplet()`
- Sends GitHub token, clones repository, updates config/env
- Target: `https://{droplet_domain}/api/update/*`

**Key Finding**: No semi-hosted support exists. All customers get droplets.

### Cyrus CLI Current Structure

From analysis of the Cyrus CLI:

**Entry Point**: `apps/cli/app.ts`
- Commands: start, check-tokens, refresh-token, add-repository, billing, set-customer-id
- Uses `SharedApplicationServer` on port 3456
- Has OAuth flow infrastructure
- Validates customer IDs via `https://www.atcyrus.com/api/subscription-status`

**Configuration**:
- Stored at `~/.cyrus/config.json`
- Type: `EdgeConfig` from cyrus-core
- Contains repositories, ngrok token, Stripe customer ID, models

---

## Proposed Architecture

### High-Level Flow

```
User Journey (Semi-Hosted):
1. Visit atcyrus.com → Select "Semi-Hosted" plan → Stripe checkout
2. Receive customer ID: cus_abc123
3. Install: npm install -g cyrus-ai
4. Run: cyrus
5. CLI prompts: "Enter customer ID" → User enters cus_abc123
6. CLI validates with: GET /api/subscription-status?customerId=cus_abc123
7. CLI prompts: "Enter ngrok auth token" → User enters ngrok token
8. CLI starts OnboardingServer on port 3456
9. CLI starts ngrok tunnel → Gets URL: https://abc123.ngrok.io
10. CLI displays: "Copy this URL and paste it on atcyrus.com"
11. User returns to atcyrus.com onboarding page
12. User pastes: https://abc123.ngrok.io
13. Website validates URL: GET https://abc123.ngrok.io/health
14. Website sends: POST https://abc123.ngrok.io/api/onboarding/verify
    - Payload: { customerId: "cus_abc123" }
    - Response: { bearerToken: "secure-random-token" }
15. Website stores ngrok_url and bearer token in database
16. User continues: GitHub → Linear → Claude (existing flow)
17. For each step, website sends to: https://abc123.ngrok.io/api/onboarding/*
18. Local Cyrus receives and configures itself
19. Success! Cyrus starts running locally
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cyrus-Hosted Website                     │
│  - Stripe checkout (2 plans: fully-hosted, semi-hosted)     │
│  - Onboarding UI (GitHub, Linear, Claude)                   │
│  - Config sender (to droplet OR ngrok URL)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ├─ Fully-Hosted ──────────────┐
                              │                              │
                              │                              ▼
                              │                    ┌──────────────────┐
                              │                    │ DigitalOcean     │
                              │                    │ Droplet          │
                              │                    │ + Update-Server  │
                              │                    └──────────────────┘
                              │
                              └─ Semi-Hosted ───────────────┐
                                                             │
                                                             ▼
                                                   ┌──────────────────┐
                                                   │ ngrok Tunnel     │
                                                   │ https://x.ngrok  │
                                                   └──────────────────┘
                                                             │
                                                             ▼
                                                   ┌──────────────────┐
                                                   │ User's Computer  │
                                                   │ Cyrus CLI        │
                                                   │ + Onboarding     │
                                                   │   Server         │
                                                   └──────────────────┘
```

---

## Implementation Plan

### Phase 1: Cyrus CLI - Create Onboarding Server Package

**New Package**: `packages/onboarding-server/`

**Structure**:
```
packages/onboarding-server/
├── src/
│   ├── index.ts                      # Main exports
│   ├── OnboardingServer.ts           # Express server class
│   ├── middleware/
│   │   ├── auth.ts                   # Bearer token authentication
│   │   └── logging.ts                # Request/response logging
│   ├── handlers/
│   │   ├── verify.ts                 # POST /api/onboarding/verify
│   │   ├── github.ts                 # POST /api/onboarding/github-credentials
│   │   ├── repository.ts             # POST /api/onboarding/repository
│   │   ├── config.ts                 # POST /api/onboarding/cyrus-config
│   │   └── env.ts                    # POST /api/onboarding/cyrus-env
│   ├── utils/
│   │   ├── validation.ts             # Input validation
│   │   └── paths.ts                  # Path resolution utilities
│   └── types.ts                      # TypeScript interfaces
├── package.json
├── tsconfig.json
└── README.md
```

**Dependencies**:
```json
{
  "dependencies": {
    "cyrus-core": "workspace:*",
    "express": "^5.1.0",
    "simple-git": "^3.x",
    "zod": "^3.22.0"
  }
}
```

**Key Classes/Functions**:

1. **OnboardingServer** (main class):
   ```typescript
   interface OnboardingServerConfig {
     port: number;
     cyrusHome: string;
   }

   class OnboardingServer {
     private bearerToken: string | null;
     private customerId: string | null;
     private isVerified: boolean;

     async start(): Promise<void>;
     async stop(): Promise<void>;
     private validateCustomerId(id: string): Promise<boolean>;
     private authMiddleware(req, res, next): void;
   }
   ```

2. **Verification Handler**:
   - Validates customer ID with atcyrus.com
   - Generates cryptographically secure bearer token
   - Returns token to website
   - Sets `isVerified = true`

3. **GitHub Credentials Handler**:
   - Receives GitHub installation token
   - Uses simple-git to configure credentials
   - Writes to `~/.git-credentials` (mode 0600)
   - No GitHub CLI dependency required

4. **Repository Handler**:
   - Clones repository using simple-git
   - Validates repository URL
   - Creates directory in user-specified location
   - Returns repository path

5. **Config Handler**:
   - Updates `~/.cyrus/config.json`
   - Validates EdgeConfig schema using zod
   - Backs up existing config if requested
   - Dynamic path resolution (no hardcoded paths)

6. **Environment Handler**:
   - Updates `.env` file (if path provided)
   - Merges with existing variables
   - Backs up existing .env if requested

### Phase 2: Cyrus CLI - Integration

**Modify**: `apps/cli/app.ts`

Add semi-hosted first-run flow:

```typescript
async function detectFirstRun(): Promise<'fully-hosted' | 'semi-hosted' | 'existing'> {
  const configExists = await configFileExists();
  if (configExists) return 'existing';

  // Check if user has valid customer ID in args or env
  const customerId = getCustomerIdFromArgsOrEnv();
  if (customerId) {
    const status = await checkSubscriptionStatus(customerId);
    return status.hostingType === 'semi-hosted' ? 'semi-hosted' : 'fully-hosted';
  }

  // Prompt user
  return await promptForSetupType();
}

async function runSemiHostedOnboarding(): Promise<void> {
  // 1. Get customer ID
  const customerId = await promptForCustomerId();

  // 2. Get ngrok token
  const ngrokToken = await promptForNgrokToken();

  // 3. Start onboarding server
  const server = new OnboardingServer({
    port: 3456,
    cyrusHome: getCyrusHome(),
  });
  await server.start();

  // 4. Start ngrok tunnel
  const ngrokUrl = await startNgrokTunnel(3456, ngrokToken);

  // 5. Display instructions
  console.log(`\n✅ Your onboarding URL:\n\n   ${ngrokUrl}\n`);
  console.log('📋 Paste this URL on atcyrus.com to continue\n');

  // 6. Wait for completion
  await waitForOnboardingComplete(server);

  // 7. Stop server and start edge worker
  await server.stop();
  await startEdgeWorker();
}
```

### Phase 3: Cyrus-Hosted - Database Changes

**New Migration**: `apps/api/supabase/migrations/[timestamp]_add_semi_hosted_support.sql`

```sql
-- Add hosting type field
ALTER TABLE public.teams
ADD COLUMN hosting_type text DEFAULT 'fully-hosted'
  CHECK (hosting_type IN ('fully-hosted', 'semi-hosted'));

-- Add ngrok fields
ALTER TABLE public.teams
ADD COLUMN ngrok_url text,
ADD COLUMN onboarding_bearer_token_encrypted text,
ADD COLUMN local_installation_verified boolean DEFAULT false,
ADD COLUMN local_installation_verified_at timestamptz;

-- Add indexes
CREATE INDEX idx_teams_hosting_type ON public.teams(hosting_type);
CREATE INDEX idx_teams_ngrok_url ON public.teams(ngrok_url) WHERE ngrok_url IS NOT NULL;

-- Add comments
COMMENT ON COLUMN public.teams.hosting_type IS 'Deployment mode: fully-hosted (DigitalOcean) or semi-hosted (local with ngrok)';
COMMENT ON COLUMN public.teams.ngrok_url IS 'Ngrok tunnel URL for semi-hosted installations';
COMMENT ON COLUMN public.teams.onboarding_bearer_token_encrypted IS 'AES-256 encrypted bearer token for local onboarding server auth';
```

**TypeScript Type Update**: `packages/supabase/src/types/db.ts`

```typescript
teams: {
  Row: {
    // ... existing fields
    hosting_type: string | null;
    ngrok_url: string | null;
    onboarding_bearer_token_encrypted: string | null;
    local_installation_verified: boolean | null;
    local_installation_verified_at: string | null;
  }
}
```

### Phase 4: Cyrus-Hosted - New API Endpoints

**New File**: `apps/app/src/app/api/subscription-status/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Stripe from "stripe";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");

  // Validate customer ID format
  if (!customerId?.startsWith("cus_")) {
    return NextResponse.json({
      hasActiveSubscription: false,
      status: "invalid_customer_id",
      requiresPayment: true
    }, { status: 400 });
  }

  // Check database for team with this customer ID
  const supabase = await createClient();
  const { data: team } = await supabase
    .from("teams")
    .select("has_valid_stripe, stripe_subscription_id, hosting_type")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!team) {
    return NextResponse.json({
      hasActiveSubscription: false,
      status: "customer_not_found",
      requiresPayment: true
    });
  }

  // Verify subscription status in Stripe
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const subscription = await stripe.subscriptions.retrieve(team.stripe_subscription_id);

  return NextResponse.json({
    hasActiveSubscription: ["active", "trialing"].includes(subscription.status),
    status: subscription.status,
    requiresPayment: !["active", "trialing"].includes(subscription.status),
    hostingType: team.hosting_type || "fully-hosted"
  });
}
```

### Phase 5: Cyrus-Hosted - Update Stripe Callback

**Modify**: `apps/app/src/app/api/stripe/callback/route.ts`

```typescript
// Determine hosting type from price ID
const priceId = session.line_items?.data[0]?.price?.id;
const hostingType = priceId === process.env.STRIPE_PRICE_ID_SEMI_HOSTED
  ? 'semi-hosted'
  : 'fully-hosted';

// Update team with hosting type
await serviceClient.from("teams").update({
  stripe_customer_id: customerId,
  stripe_subscription_id: subscription.id,
  has_valid_stripe: true,
  hosting_type: hostingType,
}).eq("id", userData.team_id);

// Conditionally provision droplet
if (hostingType === 'fully-hosted') {
  console.log(`Provisioning droplet for fully-hosted team ${userData.team_id}`);
  await provisionDroplet({ teamId: userData.team_id, useAutoDomain: true });
} else {
  console.log(`Skipping droplet for semi-hosted team ${userData.team_id}`);
  // Redirect to installation instructions instead
}
```

### Phase 6: Cyrus-Hosted - New Onboarding Page

**New File**: `apps/app/src/app/[locale]/onboarding/ngrok-setup/page.tsx`

UI page that:
1. Shows installation instructions
2. Displays customer ID prominently
3. Has input field for ngrok URL
4. "Verify Connection" button that:
   - Validates URL is accessible (GET /health)
   - Sends verification request (POST /api/onboarding/verify)
   - Stores bearer token encrypted
   - Redirects to GitHub step

### Phase 7: Cyrus-Hosted - Update Config Sender

**Modify**: `apps/app/src/lib/droplet-update/config-updater.ts`

```typescript
export async function sendOnboardingConfigToTarget(teamId: string) {
  const team = await getTeamData(teamId);

  // Determine target URL and auth
  const baseUrl = team.hosting_type === 'semi-hosted'
    ? team.ngrok_url
    : `https://${team.droplet_domain}`;

  const authToken = team.hosting_type === 'semi-hosted'
    ? decrypt(team.onboarding_bearer_token_encrypted)
    : decrypt(team.droplet_api_key_encrypted);

  const endpoint = team.hosting_type === 'semi-hosted'
    ? '/api/onboarding'
    : '/api/update';

  // Send requests
  await sendGitHubCredentials(`${baseUrl}${endpoint}/github-credentials`, authToken);
  await cloneRepository(`${baseUrl}${endpoint}/repository`, authToken);
  await updateConfig(`${baseUrl}${endpoint}/cyrus-config`, authToken);
  await updateEnv(`${baseUrl}${endpoint}/cyrus-env`, authToken);
}
```

---

## Database Changes Required

### Teams Table Additions

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `hosting_type` | text | NO | 'fully-hosted' | Deployment mode |
| `ngrok_url` | text | YES | NULL | Ngrok tunnel URL |
| `onboarding_bearer_token_encrypted` | text | YES | NULL | Encrypted auth token |
| `local_installation_verified` | boolean | YES | false | Verification status |
| `local_installation_verified_at` | timestamptz | YES | NULL | Verification timestamp |

### Indexes

```sql
CREATE INDEX idx_teams_hosting_type ON teams(hosting_type);
CREATE INDEX idx_teams_ngrok_url ON teams(ngrok_url) WHERE ngrok_url IS NOT NULL;
```

---

## API Endpoints Specification

### Cyrus CLI Onboarding Server

All endpoints require bearer token authentication (except `/health` and `/api/onboarding/verify`).

#### GET /health

**Purpose**: Health check for ngrok URL validation

**Authentication**: None

**Response**:
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

#### POST /api/onboarding/verify

**Purpose**: Verify customer ID and establish trust

**Authentication**: None (this establishes the bearer token)

**Request**:
```json
{
  "customerId": "cus_abc123"
}
```

**Response**:
```json
{
  "success": true,
  "bearerToken": "cryptographically-secure-random-token"
}
```

**Process**:
1. Validate customer ID with `GET https://www.atcyrus.com/api/subscription-status?customerId={id}`
2. Generate secure random token (32 bytes hex)
3. Store token in memory and on disk
4. Return token to caller
5. Mark server as verified

#### POST /api/onboarding/github-credentials

**Purpose**: Configure GitHub authentication

**Authentication**: Bearer token required

**Request**:
```json
{
  "token": "ghs_installationToken123"
}
```

**Response**:
```json
{
  "success": true,
  "message": "GitHub credentials configured successfully"
}
```

**Implementation**:
- Uses simple-git to configure credentials
- Writes to `~/.git-credentials` with mode 0600
- Format: `https://oauth2:{token}@github.com`

#### POST /api/onboarding/repository

**Purpose**: Clone repository locally

**Authentication**: Bearer token required

**Request**:
```json
{
  "repository_url": "https://github.com/org/repo.git",
  "repository_name": "repo"
}
```

**Response**:
```json
{
  "success": true,
  "repository_path": "/Users/username/repo",
  "message": "Repository cloned successfully"
}
```

**Implementation**:
- Uses simple-git to clone
- Clones to current working directory
- Checks for existing directory (409 Conflict if exists)

#### POST /api/onboarding/cyrus-config

**Purpose**: Update Cyrus configuration file

**Authentication**: Bearer token required

**Request**:
```json
{
  "repositories": [...],
  "ngrokAuthToken": "...",
  "stripeCustomerId": "cus_abc123",
  "defaultModel": "sonnet",
  "backupConfig": true
}
```

**Response**:
```json
{
  "success": true,
  "config_path": "/Users/username/.cyrus/config.json",
  "message": "Cyrus configuration updated successfully"
}
```

**Implementation**:
- Validates EdgeConfig schema
- Backs up existing config to `~/.cyrus/backups/config-{timestamp}.json`
- Writes to `~/.cyrus/config.json`
- Creates directory if doesn't exist

#### POST /api/onboarding/cyrus-env

**Purpose**: Update environment variables file

**Authentication**: Bearer token required

**Request**:
```json
{
  "variables": {
    "CYRUS_SERVER_PORT": "3000",
    "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat..."
  },
  "backupEnv": true
}
```

**Response**:
```json
{
  "success": true,
  "message": "Environment variables updated successfully"
}
```

**Implementation**:
- Reads existing .env if present
- Merges variables (new overwrites existing)
- Backs up to `~/.cyrus/env-backups/.env-{timestamp}`
- Writes to `~/.cyrus/.env` or custom path

### Cyrus-Hosted API

#### GET /api/subscription-status

**Purpose**: Validate Stripe customer ID for CLI

**Authentication**: None (validation via Stripe API)

**Query Parameters**:
- `customerId`: Stripe customer ID (e.g., "cus_abc123")

**Response**:
```json
{
  "hasActiveSubscription": true,
  "status": "active",
  "requiresPayment": false,
  "hostingType": "semi-hosted"
}
```

---

## Security Considerations

### 1. Customer ID Validation

**Threat**: Unauthorized access to onboarding endpoints

**Mitigation**:
- OnboardingServer validates customer ID with atcyrus.com before accepting ANY requests
- Validation checks actual subscription status in Stripe
- Server refuses all onboarding endpoints until verified

### 2. Bearer Token Security

**Threat**: Token interception during ngrok transmission

**Mitigation**:
- Token generated using crypto.randomBytes(32) - cryptographically secure
- Token transmitted over HTTPS (ngrok provides SSL)
- Token stored encrypted in database (AES-256)
- Token stored with mode 0600 on disk (~/.cyrus/onboarding-token)
- Token verified on every request

### 3. Path Traversal Prevention

**Threat**: Malicious repository names or paths

**Mitigation**:
- Repository names sanitized to remove `/`, `\`, `..`
- All paths resolved using `path.resolve()` and validated
- No direct use of user input in file system operations
- Directory creation uses `recursive: true` safely

### 4. GitHub Token Handling

**Threat**: GitHub token exposure

**Mitigation**:
- Token written to ~/.git-credentials with mode 0600 (owner read/write only)
- Token never logged or displayed
- Token transmitted over HTTPS only
- Token stored encrypted in database

### 5. Command Injection Prevention

**Threat**: Malicious input in git operations

**Mitigation**:
- Use simple-git library (no shell execution)
- All arguments passed as separate parameters
- No use of `exec()` or `spawn()` with shell: true

### 6. Ngrok URL Validation

**Threat**: Malicious ngrok URLs

**Mitigation**:
- Website validates URL is accessible before storing
- Website verifies /health endpoint responds correctly
- Website verifies /api/onboarding/verify accepts customer ID
- URL must start with https://
- Website stores encrypted bearer token separately

---

## Testing Strategy

### Unit Tests

**Package**: `packages/onboarding-server/`

Test files:
- `OnboardingServer.test.ts` - Server lifecycle, auth middleware
- `handlers/verify.test.ts` - Customer ID validation
- `handlers/github.test.ts` - GitHub credentials configuration
- `handlers/repository.test.ts` - Repository cloning
- `handlers/config.test.ts` - Config file updates
- `handlers/env.test.ts` - Environment variable updates

Mock dependencies:
- `simple-git` - Mock git operations
- `fetch` - Mock subscription status API
- `fs/promises` - Mock file operations

### Integration Tests

**Package**: `apps/cli/`

Test scenarios:
1. First-run onboarding flow (semi-hosted)
2. Customer ID validation success/failure
3. Ngrok tunnel startup
4. Onboarding server lifecycle
5. Configuration after onboarding complete

### End-to-End Tests

**Repositories**: Both `cyrus` and `cyrus-hosted`

Test scenarios:
1. Complete semi-hosted onboarding flow:
   - User signs up with semi-hosted plan
   - User receives customer ID
   - User runs CLI and provides customer ID + ngrok token
   - User pastes ngrok URL on website
   - Website sends configuration
   - CLI configures itself and starts
2. Fully-hosted flow still works (regression test)

### Manual Testing Checklist

- [ ] Semi-hosted Stripe checkout creates correct plan
- [ ] Customer ID validation endpoint works
- [ ] CLI generates secure bearer token
- [ ] Ngrok URL validation works on website
- [ ] GitHub credentials configure correctly
- [ ] Repository clones to correct location
- [ ] Config file updates with correct data
- [ ] Environment variables merge correctly
- [ ] Existing fully-hosted flow unaffected
- [ ] Error messages clear and helpful

---

## Rollout Plan

### Phase 1: Development (Week 1-2)

1. Create `packages/onboarding-server/` package
2. Implement OnboardingServer class and handlers
3. Write unit tests
4. Update CLI to integrate onboarding server
5. Test locally without involving cyrus-hosted

### Phase 2: Cyrus-Hosted Changes (Week 2-3)

1. Create database migration for semi-hosted support
2. Implement `/api/subscription-status` endpoint
3. Create new Stripe price for semi-hosted plan
4. Update Stripe callback to handle hosting type
5. Create ngrok-setup onboarding page
6. Update config sender to support ngrok URLs
7. Deploy to staging environment

### Phase 3: Testing (Week 3-4)

1. End-to-end testing on staging
2. Security review and penetration testing
3. Performance testing (ngrok latency)
4. Beta testing with select customers
5. Documentation updates

### Phase 4: Production Rollout (Week 4-5)

1. Deploy cyrus-hosted changes to production
2. Publish new cyrus-ai npm package
3. Announce semi-hosted plan availability
4. Monitor onboarding success rates
5. Collect customer feedback

### Rollback Plan

If issues arise:
- Semi-hosted customers can switch to fully-hosted
- Database migration is additive (no data loss)
- Feature flag can disable semi-hosted onboarding
- Existing fully-hosted flow unaffected

---

## Open Questions

### 1. GitHub Authentication Method

**Question**: Should we use simple-git with git credentials, or require users to have GitHub CLI installed?

**Options**:
- A) simple-git + git credentials (no external dependency)
- B) Require GitHub CLI installation
- C) Support both methods

**Recommendation**: Option A (simple-git) for simplicity

### 2. Ngrok Installation

**Question**: Should CLI automatically install ngrok if not present?

**Options**:
- A) Auto-install via @ngrok/ngrok package (current dependency)
- B) Require manual installation
- C) Offer to install if missing

**Recommendation**: Option A (already a dependency)

### 3. Repository Path Default

**Question**: Where should repositories be cloned?

**Options**:
- A) Current working directory (wherever user runs `cyrus`)
- B) `~/.cyrus/repositories/{repo-name}`
- C) Prompt user to specify

**Recommendation**: Option A (most flexible, users can cd first)

### 4. Multiple Repository Support

**Question**: Should semi-hosted onboarding support multiple repositories initially?

**Options**:
- A) One repository during onboarding, add more later via CLI
- B) Multiple repositories during onboarding

**Recommendation**: Option A (simpler onboarding experience)

### 5. Onboarding Server Lifecycle

**Question**: When should the onboarding server be running?

**Options**:
- A) Only during first-run setup, then shut down
- B) Always running alongside edge worker
- C) Start on-demand for re-onboarding

**Recommendation**: Option A (security - minimize attack surface)

### 6. Error Recovery

**Question**: If onboarding fails midway, how should we handle recovery?

**Options**:
- A) Store state in `~/.cyrus/onboarding-state.json` and allow resume
- B) Require complete restart
- C) Implement step-by-step checkpoints

**Recommendation**: Option C (best UX)

### 7. Stripe Price Structure

**Question**: How should semi-hosted pricing compare to fully-hosted?

**Options**:
- A) Same price (same features, different hosting)
- B) Lower price (we don't pay for infrastructure)
- C) Higher price (more work for user)

**Recommendation**: Option B (incentivize semi-hosted)

### 8. Testing Strategy

**Question**: How should we test without affecting production?

**Options**:
- A) Separate test Stripe account and products
- B) Feature flag in production
- C) Staging environment only

**Recommendation**: Options A + B (test account + feature flag)

---

## Success Criteria

### Must-Have (MVP)

- [ ] Semi-hosted customers can complete onboarding without droplet
- [ ] Customer ID validation works correctly
- [ ] Ngrok integration is smooth and documented
- [ ] GitHub, Linear, Claude configuration works locally
- [ ] Security requirements met (token validation, encryption)
- [ ] Backward compatibility maintained (fully-hosted still works)
- [ ] No hardcoded paths (dynamic resolution)
- [ ] Clear error messages guide users

### Nice-to-Have (Future)

- [ ] Automatic ngrok installation if missing
- [ ] Resume onboarding from checkpoint if interrupted
- [ ] Support for multiple repositories during onboarding
- [ ] CLI command to re-run onboarding
- [ ] Onboarding status dashboard on website
- [ ] Automated health checks for ngrok connectivity
- [ ] Migration tool: fully-hosted → semi-hosted

---

## Estimated Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| Planning | 1 week | Requirements, architecture, this document |
| Development | 2-3 weeks | Onboarding server package, CLI integration |
| Cyrus-Hosted Changes | 1-2 weeks | Database, API endpoints, UI |
| Testing | 1-2 weeks | Unit, integration, E2E tests |
| Documentation | 1 week | User docs, API docs, changelog |
| Rollout | 1 week | Staging → production, monitoring |
| **Total** | **7-10 weeks** | |

---

## Appendix: File Changes Summary

### New Files (Cyrus Repository)

```
packages/onboarding-server/
  src/
    index.ts
    OnboardingServer.ts
    middleware/auth.ts
    middleware/logging.ts
    handlers/verify.ts
    handlers/github.ts
    handlers/repository.ts
    handlers/config.ts
    handlers/env.ts
    utils/validation.ts
    utils/paths.ts
    types.ts
  package.json
  tsconfig.json
  README.md
```

### Modified Files (Cyrus Repository)

```
apps/cli/app.ts                       # Add semi-hosted onboarding flow
packages/edge-worker/src/types.ts     # Add OnboardingServer types
pnpm-workspace.yaml                   # Add onboarding-server package
```

### New Files (Cyrus-Hosted Repository)

```
apps/api/supabase/migrations/[timestamp]_add_semi_hosted_support.sql
apps/app/src/app/api/subscription-status/route.ts
apps/app/src/app/[locale]/onboarding/ngrok-setup/page.tsx
apps/app/src/app/[locale]/onboarding/ngrok-setup/ngrok-setup-client.tsx
```

### Modified Files (Cyrus-Hosted Repository)

```
apps/app/src/app/api/stripe/callback/route.ts           # Conditional droplet provisioning
apps/app/src/lib/droplet-update/config-updater.ts       # Support ngrok URLs
packages/supabase/src/types/db.ts                       # Add new team fields
.env.app                                                # Add STRIPE_PRICE_ID_SEMI_HOSTED
```

---

## Conclusion

This plan provides a comprehensive roadmap for implementing semi-hosted onboarding in Cyrus. The architecture maintains backward compatibility while adding support for customers who prefer to run Cyrus locally on their own infrastructure.

**Key Benefits**:
- Lower infrastructure costs (no DigitalOcean droplets for semi-hosted)
- More flexible deployment options for customers
- Maintains all existing functionality for fully-hosted customers
- Secure implementation with proper authentication and encryption
- Clear separation of concerns between hosting types

**Next Steps**:
1. Review and approve this plan
2. Answer open questions
3. Create implementation issues
4. Begin development work

---

**Document Version**: 1.0
**Last Updated**: 2025-10-14
**Author**: Claude (Cyrus Planning Agent)
**Status**: ✅ Ready for Review
