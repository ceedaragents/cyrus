# Semi-Hosted Architecture Plan for Cyrus Onboarding

**Date**: 2025-10-14
**Status**: Design Phase
**Linear Issue**: CYPACK-185

---

## Executive Summary

This document outlines the architecture for migrating from the fully-hosted model (DigitalOcean droplet with update-server) to a semi-hosted model where:
- **Ceedar provides**: Reverse proxy for ngrok URLs, Vercel-hosted onboarding UI
- **Customer provides**: Local machine running Cyrus CLI with ngrok tunnel

**Key Goals**:
1. Migrate update-server logic into Cyrus npm package
2. Enable local configuration via CLI onboarding flow
3. Maintain secure communication via ngrok tunnels
4. Optionally close-source sensitive onboarding logic

---

## Current Architecture (Fully-Hosted)

```
┌─────────────────┐
│  Vercel App     │  User onboards via web UI
│  (Next.js)      │  Collects: GitHub, Linear, Claude, Stripe
└────────┬────────┘
         │ HTTPS (Bearer Token)
         ↓
┌─────────────────┐
│  DigitalOcean   │  Provisioned droplet with:
│  Droplet        │  - nginx (SSL/TLS termination)
│  (Ubuntu)       │  - update-server (Go, port 8090)
│                 │  - Cyrus CLI (running as service)
└─────────────────┘
```

**Problems with Current Approach**:
- Expensive ($12-20/month per customer)
- Complex infrastructure (droplet provisioning, DNS, SSL)
- Centralized secrets storage
- Multi-tenant complexity

---

## New Architecture (Semi-Hosted)

```
┌─────────────────┐
│  Vercel App     │  User onboards via web UI
│  (Next.js)      │  Collects: GitHub, Linear, Claude, Stripe
└────────┬────────┘
         │ HTTPS (via ngrok URL)
         ↓
┌─────────────────┐
│  Ceedar Proxy   │  Reverse proxy layer (optional)
│  (Cloudflare    │  - Maps customer_id → ngrok URL
│   Workers?)     │  - Forwards webhooks to customer
└────────┬────────┘
         │ HTTPS
         ↓
┌─────────────────┐
│  ngrok Tunnel   │  Customer's tunnel to internet
│  (ngrok.io)     │  - Provides HTTPS endpoint
└────────┬────────┘
         │ HTTP (localhost)
         ↓
┌─────────────────┐
│  Customer's     │  Local machine running:
│  Machine        │  - Cyrus CLI (main process)
│  (macOS/Linux/  │  - Config server (embedded)
│   Windows)      │  - Local config files
└─────────────────┘
```

**Advantages**:
- No infrastructure costs (customers use their own machines)
- Simpler architecture (no droplet provisioning)
- Decentralized secrets (stored on customer machine)
- Better security (tokens never leave customer's machine)
- Works with any OS (not just Linux)

---

## New Onboarding Flow (Semi-Hosted)

### Phase 1: Web Signup & Payment

```
User → Vercel App:
  1. Sign in with GitHub OAuth
  2. Complete Stripe checkout (7-day trial)
  3. Redirected to installation instructions page
```

**Page shows**:
- Customer ID: `cus_abc123xyz`
- Installation instructions:
  ```bash
  npm install -g @cyrus-ai/cli
  cyrus onboard --customer-id cus_abc123xyz
  ```

### Phase 2: Local CLI Onboarding

**Step 1: Customer ID Verification**

```bash
$ cyrus onboard --customer-id cus_abc123xyz

Verifying customer ID with Cyrus servers...
✓ Valid subscription found!
  - Plan: Pro (7-day trial active)
  - Email: user@example.com

Starting Cyrus onboarding...
```

**Behind the scenes**:
- CLI calls Vercel API: `POST /api/cli/verify-customer`
- Request body: `{ "customer_id": "cus_abc123xyz" }`
- Response: `{ "valid": true, "email": "...", "subscription_status": "trialing" }`
- Vercel checks Stripe API for valid subscription

**Step 2: ngrok Setup**

```bash
Do you have an ngrok account? (Y/n): Y

Please enter your ngrok auth token: [paste token]

Setting up ngrok tunnel...
✓ ngrok tunnel established!
  - Public URL: https://abc-123-def.ngrok-free.app
  - Local port: 3456

IMPORTANT: Copy this URL and paste it in the Cyrus web app.
Press Enter when done...
```

**Behind the scenes**:
- CLI prompts for ngrok token (or auto-detects `~/.ngrok2/ngrok.yml`)
- Starts ngrok tunnel on random port (3456)
- Starts local config server on that port
- Config server exposes update-server endpoints (migrated from Go)

**Step 3: Verify ngrok URL**

User returns to Vercel app, which is polling or has a form:

```
┌─────────────────────────────────────────┐
│  Setup Progress                         │
│  ✓ Subscription created                 │
│  ⏳ Waiting for Cyrus CLI connection... │
│                                         │
│  [Input: Paste your ngrok URL here]    │
│         https://abc-123-def.ngrok-free.app
│  [Verify Connection]                    │
└─────────────────────────────────────────┘
```

When user clicks "Verify Connection":
- Vercel calls: `GET https://abc-123-def.ngrok-free.app/health`
- If successful, saves ngrok URL to database:
  ```sql
  UPDATE teams SET
    ngrok_url = 'https://abc-123-def.ngrok-free.app',
    cli_connected = true
  WHERE stripe_customer_id = 'cus_abc123xyz';
  ```
- Redirects user to existing onboarding flow

### Phase 3: OAuth & Configuration

User continues onboarding in Vercel app (same as current):

```
1. GitHub App Installation
   → Vercel collects installation_id

2. Linear OAuth
   → Vercel collects access_token

3. Claude API Key
   → Vercel collects claude_api_key

As each step completes, Vercel sends config to CLI:
```

**After each step, Vercel sends to CLI**:

```typescript
// Example: After GitHub App installed
POST https://abc-123-def.ngrok-free.app/api/config/github
Authorization: Bearer <customer_secret>
Content-Type: application/json

{
  "installation_id": "12345678",
  "organization": "my-org",
  "repositories": ["my-org/repo-name"],
  "installation_token": "ghs_abc123..." // short-lived
}
```

CLI config server receives and:
1. Validates request (checks Bearer token)
2. Runs `gh auth login --with-token`
3. Clones repository to local path
4. Updates `~/.cyrus/config.json`
5. Returns success

**Similar flows for**:
- Linear: `POST /api/config/linear`
- Claude: `POST /api/config/claude`
- Repository selection: `POST /api/config/repository`

### Phase 4: Completion

```bash
$ cyrus onboard --customer-id cus_abc123xyz

...

✓ GitHub connected!
✓ Repository cloned: my-org/repo-name
✓ Linear workspace connected: My Workspace
✓ Claude API key configured
✓ Onboarding complete!

Starting Cyrus agent...
```

Cyrus agent starts running with full configuration.

User sees dashboard in Vercel app showing "Connected ✓"

---

## Technical Design

### 1. New Package: `@cyrus-ai/config-server`

**Location**: `packages/config-server/`

**Purpose**: Embedded HTTP server that exposes configuration endpoints (migrated from Go update-server)

**Key Files**:
```
packages/config-server/
├── src/
│   ├── server.ts              # Express/Fastify server
│   ├── routes/
│   │   ├── health.ts          # GET /health
│   │   ├── github.ts          # POST /api/config/github
│   │   ├── linear.ts          # POST /api/config/linear
│   │   ├── claude.ts          # POST /api/config/claude
│   │   ├── repository.ts      # POST /api/config/repository
│   │   └── mcp.ts             # POST /api/config/mcp
│   ├── handlers/
│   │   ├── github-handler.ts  # Port from Go: handlers/github.go
│   │   ├── config-handler.ts  # Port from Go: handlers/cyrus_config.go
│   │   ├── env-handler.ts     # Port from Go: handlers/env.go
│   │   ├── repo-handler.ts    # Port from Go: handlers/repository.go
│   │   └── mcp-handler.ts     # Port from Go: handlers/configure_mcp.go
│   ├── middleware/
│   │   ├── auth.ts            # Bearer token validation
│   │   └── logging.ts         # Request/response logging
│   └── index.ts               # Entry point
├── package.json
└── tsconfig.json
```

**API Endpoints** (migrated from update-server):
- `GET /health` - Health check
- `POST /api/config/github` - Update GitHub credentials
- `POST /api/config/linear` - Update Linear credentials
- `POST /api/config/claude` - Update Claude API key
- `POST /api/config/repository` - Clone repository
- `POST /api/config/cyrus-config` - Update main config
- `POST /api/config/mcp` - Configure MCP servers
- `POST /api/config/test-mcp` - Test MCP connection

**Authentication**:
- Each customer gets a unique Bearer token generated during CLI setup
- Token stored in `~/.cyrus/onboarding.json`:
  ```json
  {
    "customer_id": "cus_abc123xyz",
    "secret": "randomly-generated-32-byte-token",
    "ngrok_url": "https://abc-123-def.ngrok-free.app",
    "onboarding_completed": true
  }
  ```
- Vercel stores the token in database:
  ```sql
  ALTER TABLE teams ADD COLUMN cli_secret_hash VARCHAR(64);
  -- Stored as bcrypt hash for security
  ```

**Port Allocation**:
- Random port between 30000-40000
- Configurable via environment variable: `CYRUS_CONFIG_SERVER_PORT`

### 2. Modified CLI: `apps/cli/`

**New commands**:

```typescript
// apps/cli/src/commands/onboard.ts
export const onboardCommand = new Command('onboard')
  .description('Start Cyrus onboarding process')
  .requiredOption('--customer-id <id>', 'Stripe customer ID from Cyrus website')
  .action(async (options) => {
    const onboardingService = new OnboardingService();
    await onboardingService.start(options.customerId);
  });
```

**New service**: `apps/cli/src/services/OnboardingService.ts`

```typescript
class OnboardingService {
  async start(customerId: string) {
    // 1. Verify customer ID with Vercel API
    const customer = await this.verifyCustomer(customerId);

    // 2. Setup ngrok tunnel
    const ngrokUrl = await this.setupNgrok();

    // 3. Start config server
    const server = await this.startConfigServer();

    // 4. Register ngrok URL with Vercel
    await this.registerNgrokUrl(customerId, ngrokUrl);

    // 5. Wait for configuration from Vercel
    await this.waitForConfiguration();

    // 6. Complete onboarding
    console.log('✓ Onboarding complete!');
  }

  private async verifyCustomer(customerId: string) {
    const response = await fetch('https://app.cyrus.ai/api/cli/verify-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: customerId })
    });

    if (!response.ok) {
      throw new Error('Invalid customer ID or expired subscription');
    }

    return response.json();
  }

  private async setupNgrok() {
    // Use @ngrok/ngrok package
    const ngrok = await import('@ngrok/ngrok');

    // Check if user has ngrok configured
    const ngrokConfig = await this.loadNgrokConfig();
    if (!ngrokConfig) {
      const token = await this.promptForNgrokToken();
      await this.saveNgrokConfig(token);
    }

    // Start tunnel
    const listener = await ngrok.connect({
      addr: 3456, // config server port
      authtoken: ngrokConfig.authtoken
    });

    return listener.url();
  }

  private async startConfigServer() {
    const { ConfigServer } = await import('@cyrus-ai/config-server');

    const secret = this.generateSecret();

    const server = new ConfigServer({
      port: 3456,
      secret,
      cyrusHome: this.getCyrusHome(),
      onConfigUpdate: (type) => {
        console.log(`✓ ${type} configured!`);
      }
    });

    await server.start();

    // Save secret for later
    await this.saveOnboardingState({ secret });

    return server;
  }

  private async registerNgrokUrl(customerId: string, ngrokUrl: string) {
    console.log('\nCopy this URL and paste it in the Cyrus web app:');
    console.log(`\n  ${ngrokUrl}\n`);

    await this.waitForEnter();

    // Optionally auto-verify
    const response = await fetch('https://app.cyrus.ai/api/cli/register-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId,
        ngrok_url: ngrokUrl,
        secret: this.getSecret()
      })
    });

    if (!response.ok) {
      throw new Error('Failed to register ngrok URL');
    }
  }

  private async waitForConfiguration() {
    const spinner = ora('Waiting for configuration from Cyrus app...').start();

    // Poll local state file written by config server
    while (true) {
      const state = await this.loadOnboardingState();

      if (state.github && state.linear && state.claude) {
        spinner.succeed('All configuration received!');
        break;
      }

      await sleep(2000);
    }
  }
}
```

**Dependencies to add**:
```json
{
  "dependencies": {
    "@ngrok/ngrok": "^1.0.0",
    "@cyrus-ai/config-server": "workspace:*",
    "ora": "^6.0.0",
    "prompts": "^2.4.2"
  }
}
```

### 3. Vercel API Changes: `apps/app/`

**New API routes**:

```typescript
// apps/app/src/app/api/cli/verify-customer/route.ts
export async function POST(request: Request) {
  const { customer_id } = await request.json();

  // Query Supabase
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id, stripe_subscription_id, stripe_customer_id')
    .eq('stripe_customer_id', customer_id)
    .single();

  if (!team) {
    return Response.json({ error: 'Invalid customer ID' }, { status: 404 });
  }

  // Verify subscription with Stripe
  const subscription = await stripe.subscriptions.retrieve(team.stripe_subscription_id);

  if (!['active', 'trialing'].includes(subscription.status)) {
    return Response.json({ error: 'Subscription not active' }, { status: 403 });
  }

  // Get user email
  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('id', team.owner_id)
    .single();

  return Response.json({
    valid: true,
    email: user.email,
    subscription_status: subscription.status
  });
}
```

```typescript
// apps/app/src/app/api/cli/register-url/route.ts
export async function POST(request: Request) {
  const { customer_id, ngrok_url, secret } = await request.json();

  // Validate ngrok URL is reachable
  try {
    const response = await fetch(`${ngrok_url}/health`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return Response.json({ error: 'ngrok URL not reachable' }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: 'Failed to connect to ngrok URL' }, { status: 400 });
  }

  // Hash the secret (bcrypt)
  const secretHash = await bcrypt.hash(secret, 10);

  // Update database
  const { error } = await supabase
    .from('teams')
    .update({
      ngrok_url,
      cli_secret_hash: secretHash,
      cli_connected: true,
      cli_connected_at: new Date().toISOString()
    })
    .eq('stripe_customer_id', customer_id);

  if (error) {
    return Response.json({ error: 'Failed to register URL' }, { status: 500 });
  }

  return Response.json({ success: true });
}
```

**Modified onboarding pages**:

```typescript
// apps/app/src/app/[locale]/onboarding/subscription/success/page.tsx

// Add ngrok URL registration step BEFORE GitHub App installation

export default function SubscriptionSuccessPage() {
  const [ngrokUrl, setNgrokUrl] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function handleVerifyConnection() {
    setVerifying(true);

    // Call health check
    const response = await fetch(`${ngrokUrl}/health`);
    if (!response.ok) {
      toast.error('Could not connect to Cyrus CLI');
      return;
    }

    // Save to database
    await fetch('/api/cli/register-url', {
      method: 'POST',
      body: JSON.stringify({ ngrok_url: ngrokUrl })
    });

    toast.success('Cyrus CLI connected!');

    // Continue to GitHub step
    router.push('/onboarding/github');
  }

  return (
    <div>
      <h1>Connect Your Cyrus CLI</h1>

      <ol>
        <li>Install Cyrus CLI:
          <pre>npm install -g @cyrus-ai/cli</pre>
        </li>
        <li>Start onboarding:
          <pre>cyrus onboard --customer-id {team.stripe_customer_id}</pre>
        </li>
        <li>Copy your ngrok URL from the CLI and paste below:</li>
      </ol>

      <input
        type="url"
        placeholder="https://abc-123-def.ngrok-free.app"
        value={ngrokUrl}
        onChange={(e) => setNgrokUrl(e.target.value)}
      />

      <button onClick={handleVerifyConnection} disabled={verifying}>
        Verify Connection
      </button>
    </div>
  );
}
```

**Modified configuration flow**:

Instead of sending config to `https://{droplet_domain}/api/update/*`, send to `{ngrok_url}/api/config/*`:

```typescript
// apps/app/src/lib/cli-update/client.ts (new file, replaces droplet-update/client.ts)

export class CLIUpdateClient {
  constructor(
    private ngrokUrl: string,
    private secret: string
  ) {}

  async updateGitHubCredentials(token: string) {
    return this.request('/api/config/github', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  }

  async cloneRepository(url: string, name: string) {
    return this.request('/api/config/repository', {
      method: 'POST',
      body: JSON.stringify({
        repository_url: url,
        repository_name: name
      })
    });
  }

  async updateCyrusConfig(config: CyrusConfig) {
    return this.request('/api/config/cyrus-config', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  private async request(path: string, options: RequestInit) {
    const response = await fetch(`${this.ngrokUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.secret}`,
        ...options.headers
      },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`CLI API error: ${response.statusText}`);
    }

    return response.json();
  }
}
```

**Usage in onboarding**:

```typescript
// After GitHub App installed
const client = new CLIUpdateClient(team.ngrok_url, decryptSecret(team.cli_secret_hash));

// Send GitHub token
await client.updateGitHubCredentials(installationToken);

// Clone repo
await client.cloneRepository(repo.github_url, repo.name);

// Update config
await client.updateCyrusConfig({
  repositories: [...],
  linearOrganizationId: team.linear_organization_id,
  linearAccessToken: team.linear_access_token,
  stripeCustomerId: team.stripe_customer_id
});

// Update env vars
await client.updateCyrusEnv({
  CLAUDE_CODE_OAUTH_TOKEN: decryptClaudeKey(team.claude_api_key),
  CYRUS_SERVER_PORT: '3000',
  LINEAR_DIRECT_WEBHOOKS: 'true'
});
```

### 4. Database Schema Changes

```sql
-- Add CLI connection fields
ALTER TABLE teams ADD COLUMN ngrok_url TEXT;
ALTER TABLE teams ADD COLUMN cli_secret_hash VARCHAR(64);
ALTER TABLE teams ADD COLUMN cli_connected BOOLEAN DEFAULT FALSE;
ALTER TABLE teams ADD COLUMN cli_connected_at TIMESTAMPTZ;

-- Remove droplet fields (no longer needed for semi-hosted)
-- Keep for backward compatibility with fully-hosted customers
-- Determine customer type by: if ngrok_url IS NOT NULL then 'semi-hosted' else 'fully-hosted'
```

### 5. Webhook Routing

**Current (Fully-Hosted)**:
```
Linear → Vercel → Droplet nginx → Cyrus CLI
```

**New (Semi-Hosted) - Option A: Direct Routing**:
```
Linear → ngrok → Cyrus CLI
```

User configures Linear webhook to point to their ngrok URL:
- Webhook URL: `https://abc-123-def.ngrok-free.app/webhooks/linear`

**New (Semi-Hosted) - Option B: Proxy Routing** (RECOMMENDED):
```
Linear → Vercel Proxy → ngrok → Cyrus CLI
```

Vercel acts as a router:
1. Linear sends webhook to: `https://app.cyrus.ai/api/webhooks/linear`
2. Vercel looks up customer by Linear organization ID
3. Vercel forwards to customer's ngrok URL
4. Vercel validates webhook signature before forwarding

**Implementation**:

```typescript
// apps/app/src/app/api/webhooks/linear/route.ts
export async function POST(request: Request) {
  const signature = request.headers.get('linear-signature');
  const body = await request.text();

  // Verify signature
  if (!verifyLinearSignature(body, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Look up team by Linear organization ID
  const { data: team } = await supabase
    .from('teams')
    .select('ngrok_url, cli_secret_hash')
    .eq('linear_organization_id', payload.organizationId)
    .single();

  if (!team || !team.ngrok_url) {
    return Response.json({ error: 'Team not found' }, { status: 404 });
  }

  // Forward to customer's CLI
  const response = await fetch(`${team.ngrok_url}/webhooks/linear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Signature': signature // forward signature
    },
    body
  });

  // Return response from CLI
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Advantages of Option B**:
- Single webhook URL for Linear (customer doesn't need to configure)
- Vercel validates signatures before forwarding
- Vercel can log/monitor webhook traffic
- Customer's ngrok URL can change without updating Linear

**Disadvantages**:
- Additional hop (latency +50-100ms)
- Vercel function timeout limits (10s for hobby, 60s for pro)

**Recommendation**: Use Option B (Proxy Routing)

---

## Closed-Source Strategy

### Problem Statement

The update-server logic contains proprietary onboarding flow that we want to keep closed-source, while the rest of Cyrus remains open-source.

### Option 1: Private NPM Package (RECOMMENDED)

**Structure**:
```
packages/
├── config-server/          # ❌ PRIVATE (published to npm with private flag)
├── core/                   # ✅ Open-source
├── claude-runner/          # ✅ Open-source
├── edge-worker/            # ✅ Open-source
└── ...                     # ✅ Open-source

apps/
├── cli/                    # ✅ Open-source (depends on private package)
└── ...
```

**Implementation**:

1. **Create private package**:
   ```json
   // packages/config-server/package.json
   {
     "name": "@cyrus-ai/config-server",
     "version": "0.1.0",
     "private": true,  // Prevents accidental public publish
     "publishConfig": {
       "access": "restricted"  // Requires npm paid plan
     }
   }
   ```

2. **Publish to npm private registry**:
   ```bash
   cd packages/config-server
   npm publish --access restricted
   ```

3. **CLI depends on private package**:
   ```json
   // apps/cli/package.json
   {
     "dependencies": {
       "@cyrus-ai/config-server": "^0.1.0"  // Installed from npm
     }
   }
   ```

4. **Users install CLI**:
   ```bash
   npm install -g @cyrus-ai/cli
   # Automatically installs private @cyrus-ai/config-server
   # Users need npm authentication to install
   ```

**Authentication for users**:
- Users need to authenticate with npm: `npm login --scope=@cyrus-ai`
- Provide credentials during onboarding (or embed in installation script)
- Alternative: Use `.npmrc` file with read-only token

**Cost**: $7/month for npm Teams plan

**Pros**:
- Simple to implement
- Standard npm workflow
- Works with existing tooling
- Can use npm's access controls

**Cons**:
- Requires users to authenticate with npm
- Costs $7/month
- Private packages visible to anyone with access

### Option 2: Separate Private Repository

**Structure**:
```
# Public repo: github.com/ceedar-ai/cyrus (main monorepo)
packages/
├── core/
├── claude-runner/
└── ...

apps/
├── cli/
└── ...

# Private repo: github.com/ceedar-ai/cyrus-config-server
packages/
└── config-server/
```

**Implementation**:

1. **Create private repository**
2. **CLI fetches at runtime**:
   ```typescript
   // apps/cli/src/services/OnboardingService.ts
   async startConfigServer() {
     // Download private package from Ceedar CDN
     const pkg = await this.downloadConfigServer();

     // Load dynamically
     const { ConfigServer } = await import(pkg);

     // Start server
     const server = new ConfigServer({ ... });
     await server.start();
   }

   private async downloadConfigServer() {
     // Authenticate with customer_id
     const response = await fetch('https://cdn.cyrus.ai/config-server/latest.tgz', {
       headers: {
         'Authorization': `Bearer ${this.customerId}`
       }
     });

     // Download to temp directory
     const buffer = await response.arrayBuffer();
     const tmpDir = await this.extractToTemp(buffer);

     return path.join(tmpDir, 'index.js');
   }
   ```

**Pros**:
- Complete control over distribution
- Can enforce licensing per customer
- No npm costs

**Cons**:
- Complex implementation
- Need to host CDN
- Runtime download adds latency
- Harder to debug/maintain

### Option 3: Obfuscated Code in Public Repo

**Structure**:
```
packages/
├── config-server/          # ✅ Public (but obfuscated)
│   ├── src/                # Original TypeScript (private)
│   └── dist/               # Obfuscated JavaScript (committed to git)
```

**Implementation**:

1. **Write code normally in TypeScript**
2. **Build and obfuscate**:
   ```bash
   tsc && javascript-obfuscator dist/ --output dist-obfuscated/
   ```
3. **Commit only obfuscated dist**:
   ```gitignore
   # packages/config-server/.gitignore
   src/        # Don't commit source
   dist/       # Don't commit readable JS
   ```

**Pros**:
- No authentication needed
- No distribution infrastructure
- Works with standard npm

**Cons**:
- Security through obscurity (not true protection)
- Can be reverse-engineered
- Harder to debug
- Not recommended for serious IP protection

### Recommendation: Option 1 (Private NPM Package)

**Rationale**:
- Industry-standard approach
- Easy to implement and maintain
- Provides real access control
- Works seamlessly with npm workflow
- Worth the $7/month cost

**Implementation Plan**:
1. Create private npm organization: `@cyrus-ai`
2. Publish `@cyrus-ai/config-server` as private package
3. Update CLI to depend on private package
4. Provide npm authentication during onboarding:
   ```bash
   cyrus onboard --customer-id cus_abc123xyz

   To complete onboarding, authenticate with npm:
     npm login --scope=@cyrus-ai

   Username: <email>
   Password: <provided-during-signup>
   ```

---

## Migration Roadmap

### Phase 1: Extract & Migrate Update-Server Logic (2-3 weeks)

**Week 1**:
- [ ] Create `packages/config-server/` package
- [ ] Port Go handlers to TypeScript:
  - [ ] `github.go` → `github-handler.ts`
  - [ ] `cyrus_config.go` → `config-handler.ts`
  - [ ] `env.go` → `env-handler.ts`
  - [ ] `repository.go` → `repo-handler.ts`
  - [ ] `configure_mcp.go` → `mcp-handler.ts`
  - [ ] `test_mcp.go` → `mcp-test-handler.ts`
- [ ] Create Express/Fastify server with routes
- [ ] Add authentication middleware (Bearer token)
- [ ] Write unit tests for handlers

**Week 2**:
- [ ] Set up private npm package publishing
- [ ] Create npm organization `@cyrus-ai`
- [ ] Publish `@cyrus-ai/config-server` as private package
- [ ] Test installation and authentication

**Week 3**:
- [ ] Update CLI with onboarding command
- [ ] Implement `OnboardingService` class
- [ ] Add ngrok integration
- [ ] Test end-to-end locally

### Phase 2: Update Vercel App (1-2 weeks)

**Week 4**:
- [ ] Add database fields for CLI connection
- [ ] Create new API routes:
  - [ ] `POST /api/cli/verify-customer`
  - [ ] `POST /api/cli/register-url`
- [ ] Update onboarding flow to include ngrok step
- [ ] Create `CLIUpdateClient` class
- [ ] Update configuration flow to use ngrok URLs

**Week 5**:
- [ ] Implement webhook proxy routing
- [ ] Test with Linear webhooks
- [ ] Update dashboard to show CLI connection status
- [ ] Add troubleshooting UI for connection issues

### Phase 3: Testing & Documentation (1 week)

**Week 6**:
- [ ] End-to-end testing with real user flow
- [ ] Write installation documentation
- [ ] Create troubleshooting guides
- [ ] Record demo video
- [ ] Internal alpha testing

### Phase 4: Beta Launch (2 weeks)

**Week 7-8**:
- [ ] Invite beta users
- [ ] Monitor for issues
- [ ] Gather feedback
- [ ] Iterate on UX improvements
- [ ] Prepare for public launch

### Phase 5: General Availability (Ongoing)

- [ ] Public launch
- [ ] Customer support
- [ ] Monitor usage and errors
- [ ] Continue improvements

---

## Technical Considerations

### 1. ngrok Limitations

**Free Tier**:
- 1 online ngrok agent per account
- 40 connections/minute
- Random subdomain (changes on restart)

**Paid Tier** ($8/month):
- 3 online agents
- 120 connections/minute
- Reserved subdomain (persistent)
- Custom domains

**Recommendation**: Require users to have ngrok paid tier for persistent URLs

### 2. Platform Support

**Operating Systems**:
- macOS ✅ (primary target)
- Linux ✅ (should work with minimal changes)
- Windows ⚠️ (may need adjustments for paths, services)

**Node.js Versions**:
- Minimum: Node.js 18
- Recommended: Node.js 20+

### 3. Security

**Token Storage**:
- CLI secret stored in `~/.cyrus/onboarding.json` (chmod 600)
- Vercel stores bcrypt hash (never stores plaintext)
- All communication over HTTPS (via ngrok)

**Authentication Flow**:
```
Vercel → ngrok URL
Header: Authorization: Bearer <secret>

CLI Config Server validates:
1. Secret matches stored secret
2. Request is valid JSON
3. Operation is allowed
```

**Risks**:
- ngrok URL could be discovered (but requires secret)
- Secret could be stolen from `~/.cyrus/onboarding.json`
- Mitigations: File permissions, encrypt secret on disk

### 4. Monitoring & Debugging

**CLI Logging**:
```typescript
// Save logs to ~/.cyrus/logs/config-server.log
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: path.join(CYRUS_HOME, 'logs', 'config-server.log')
    })
  ]
});
```

**Vercel Logging**:
```typescript
// Log all CLI API calls
await supabase
  .from('cli_api_logs')
  .insert({
    team_id,
    endpoint: '/api/config/github',
    success: true,
    response_time_ms: 123
  });
```

**Health Checks**:
```typescript
// Vercel can periodically check CLI health
async function checkCLIHealth(team) {
  try {
    const response = await fetch(`${team.ngrok_url}/health`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      // Alert team that CLI is unreachable
      await sendSlackNotification(`CLI unreachable for team ${team.id}`);
    }
  } catch (error) {
    // CLI is offline
  }
}
```

---

## Cost Analysis

### Fully-Hosted (Current)
- DigitalOcean Droplet: $12-20/month per customer
- 100 customers: $1,200-2,000/month
- 1,000 customers: $12,000-20,000/month

### Semi-Hosted (New)
- ngrok paid tier (optional): $8/month per customer (paid by customer)
- npm private package: $7/month (one-time, not per customer)
- Vercel function calls: ~$0.01-0.05/month per customer
- 100 customers: $7 + ($0.05 × 100) = ~$12/month
- 1,000 customers: $7 + ($0.05 × 1000) = ~$57/month

**Savings**:
- 100 customers: $1,188-1,988/month saved (99% reduction)
- 1,000 customers: $11,943-19,943/month saved (99% reduction)

---

## User Experience Comparison

### Fully-Hosted
```
1. Sign up on web
2. Complete Stripe checkout
3. Install GitHub App
4. Connect Linear
5. Enter Claude key
6. Wait 10-15 minutes for droplet
7. ✓ Ready to use
```

### Semi-Hosted
```
1. Sign up on web
2. Complete Stripe checkout
3. See installation instructions
4. Install CLI: npm install -g @cyrus-ai/cli
5. Run: cyrus onboard --customer-id cus_xxx
6. Paste ngrok URL in web app
7. Install GitHub App
8. Connect Linear
9. Enter Claude key
10. ✓ Ready to use (immediately)
```

**Pros**:
- No waiting for infrastructure
- Works on any machine (not just Linux)
- Immediate start (no provisioning delay)

**Cons**:
- More steps (install CLI, setup ngrok)
- Requires terminal/CLI knowledge
- Customer machine must stay on

---

## Open Questions for User

1. **ngrok Requirement**: Should we require users to have ngrok paid tier ($8/month) for reserved URLs? Or allow free tier with regeneration handling?

2. **CLI Distribution**: Is private npm package the right approach? Or prefer bundled binary (with embedded config-server)?

3. **Webhook Routing**: Should we use proxy routing (Vercel → ngrok) or direct routing (Linear → ngrok)? Proxy adds reliability but also latency.

4. **Backward Compatibility**: Should we support both fully-hosted (droplets) and semi-hosted (CLI) customers simultaneously? Or migrate all customers?

5. **Windows Support**: Is Windows support required? This may need additional work for service management and path handling.

6. **Automatic Updates**: How should CLI updates work? Auto-update on startup? Manual npm update? Background updater service?

7. **Multi-Repository Support**: Should one CLI instance support multiple repositories? Or one CLI per repository?

8. **Health Monitoring**: Should Vercel actively monitor CLI health and alert users if offline? Or leave it to customer to notice?

9. **Customer Support**: How will we debug issues on customer machines? Remote access? Diagnostic scripts? Log uploads?

10. **Migration Path**: For existing fully-hosted customers, should we offer migration to semi-hosted? How to handle downtime during migration?

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Answer open questions** above
3. **Get user approval** before starting implementation
4. **Create detailed tickets** for each phase
5. **Assign developers** and set timeline
6. **Begin Phase 1** (extract & migrate update-server)

---

## References

- Current update-server: `/Users/agentops/code/cyrus-update-server`
- Current Vercel app: `/Users/agentops/code/cyrus-hosted`
- Cyrus main repo: `/Users/agentops/code/cyrus-workspaces/CYPACK-185`
- Linear issue: CYPACK-185
