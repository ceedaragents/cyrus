# Cyrus Proxy Worker (Cloudflare Workers)

A Cloudflare Worker that serves as an edge proxy for the Cyrus Linear Agent, handling OAuth flows, webhooks, and token management using KV storage.

## 🚀 Quick Setup

### Automated Setup (Recommended)

```bash
# Make sure you're authenticated with Cloudflare
npx wrangler login

# Run the fully automated setup script
./scripts/setup-wrangler.sh

# Or combine setup with immediate action:
./scripts/setup-wrangler.sh --dev            # Setup + start dev server
./scripts/setup-wrangler.sh --deploy         # Setup + deploy to production
./scripts/setup-wrangler.sh --preview        # Setup + create preview version
./scripts/setup-wrangler.sh --force-secrets  # Force update all secrets
```

That's it! The script will:
- Create all required KV namespaces (production + preview)
- Update `wrangler.toml` with the correct namespace IDs
- Create a backup of your existing configuration
- Load secrets from `.env` file if available
- Generate encryption key automatically if missing
- Deploy all secrets to both production and preview environments
- Provide clear next-step commands

### Manual Setup

If you prefer to set up manually or need to understand the process:

1. **Authenticate with Cloudflare**
   ```bash
   npx wrangler login
   ```

2. **Create KV Namespaces**
   ```bash
   # Production namespaces
   npx wrangler kv namespace create OAUTH_TOKENS
   npx wrangler kv namespace create OAUTH_STATE
   npx wrangler kv namespace create EDGE_TOKENS
   npx wrangler kv namespace create WORKSPACE_METADATA
   
   # Preview namespaces (for development)
   npx wrangler kv namespace create OAUTH_TOKENS --preview
   npx wrangler kv namespace create OAUTH_STATE --preview
   npx wrangler kv namespace create EDGE_TOKENS --preview
   npx wrangler kv namespace create WORKSPACE_METADATA --preview
   ```

3. **Update wrangler.toml**
   
   Copy the namespace IDs from the command outputs and update your `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "OAUTH_TOKENS"
   id = "your-production-id-here"
   preview_id = "your-preview-id-here"
   
   # ... repeat for other namespaces
   ```

## 🛠 Development

### Start Development Server
```bash
npm run dev
# or
npx wrangler dev
```

### Deploy to Production
```bash
npm run deploy
# or
npx wrangler deploy
```

### Create Preview Version
```bash
npm run preview
# or
npx wrangler versions upload
```

This uploads a new version and returns a preview URL for testing without affecting production.

**Note**: Each preview upload creates a new version. You can manage versions with:
```bash
npx wrangler versions list                    # List all versions
npx wrangler versions view <version-id>       # View specific version
npx wrangler versions deploy <version-id>     # Promote version to production
```

### View Logs
```bash
npm run tail
# or
npx wrangler tail
```

## 🗂️ KV Namespaces

The worker uses four KV namespaces for data storage:

- **OAUTH_TOKENS**: Stores OAuth access tokens and refresh tokens
- **OAUTH_STATE**: Temporary storage for OAuth state parameters
- **EDGE_TOKENS**: Edge-specific authentication tokens
- **WORKSPACE_METADATA**: Linear workspace configuration and metadata

### Managing KV Data

```bash
# List all namespaces
npx wrangler kv namespace list

# View keys in a namespace
npx wrangler kv key list --namespace-id <namespace-id>

# Get a specific value
npx wrangler kv key get <key> --namespace-id <namespace-id>

# Set a value
npx wrangler kv key put <key> <value> --namespace-id <namespace-id>
```

## 🔧 Configuration

### Environment Variables

For automated setup, create a `.env` file with your configuration:

```bash
# Copy the example file and customize it
cp .env.example .env
# Edit .env with your actual values
```

Or export the variables directly:

```bash
# Your deployed worker URL (required)
export PROXY_URL=https://your-worker.workers.dev

# Linear OAuth credentials (from Linear app settings)
export LINEAR_CLIENT_ID=your_linear_client_id
export LINEAR_CLIENT_SECRET=your_linear_client_secret
export LINEAR_WEBHOOK_SECRET=your_linear_webhook_secret

# Encryption key (32-byte hex) - will be auto-generated if not provided
export ENCRYPTION_KEY=your_32_byte_hex_encryption_key
```

Then source your `.env` file:
```bash
source .env  # then run the setup script
```

**Note**: The OAuth redirect URI is automatically constructed as `${PROXY_URL}/oauth/callback`

### Wrangler Configuration

Set in `wrangler.toml` under `[vars]`:
- `PROXY_URL`: Your deployed worker URL (auto-configured during setup)

### Secrets (Required)

The following secrets MUST be configured for the proxy worker to function properly:

```bash
# Required secrets for production
npx wrangler secret put LINEAR_CLIENT_ID        # Your Linear OAuth app Client ID
npx wrangler secret put LINEAR_CLIENT_SECRET    # Your Linear OAuth app Client Secret
npx wrangler secret put LINEAR_WEBHOOK_SECRET   # Secret for verifying Linear webhooks
npx wrangler secret put ENCRYPTION_KEY          # 32-byte hex key for encrypting tokens

# Required secrets for preview/development
npx wrangler secret put LINEAR_CLIENT_ID --env preview
npx wrangler secret put LINEAR_CLIENT_SECRET --env preview
npx wrangler secret put LINEAR_WEBHOOK_SECRET --env preview
npx wrangler secret put ENCRYPTION_KEY --env preview
```

#### How to obtain these secrets:

1. **LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET & LINEAR_WEBHOOK_SECRET**: 
   - Create a new Linear OAuth application: https://linear.app/settings/api/applications/new
   - Fill in the application details
   - **Important**: Enable webhooks and select "Agent session events" under webhook settings
   - Copy the Client ID, Client Secret, and Webhook Secret
   
   **Note**: If you encounter "There is already a user in Linear associated with this Github account", you may need to create a new GitHub username for your Linear agent.

2. **ENCRYPTION_KEY**:
   - Generate a secure 32-byte hex key:
   ```bash
   # Generate using OpenSSL
   openssl rand -hex 32
   # Or using Node.js
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## 🧹 Cleanup

To remove all KV namespaces and reset the workspace:

```bash
./scripts/cleanup-wrangler.sh
```

This will:
- Delete all Cyrus-related KV namespaces
- Restore your `wrangler.toml` from backup
- Clean up any temporary files

## 📋 Scripts Reference

- `./scripts/setup-wrangler.sh` - Automated workspace setup
- `./scripts/cleanup-wrangler.sh` - Clean up all resources
- `npm run dev` - Start development server
- `npm run deploy` - Deploy to production
- `npm run preview` - Upload preview version (returns preview URL)
- `npm run tail` - View real-time logs
- `npm run typecheck` - Run TypeScript type checking

## 🏗️ Project Structure

```
proxy-worker/
├── src/
│   └── index.ts          # Main Worker entry point
├── scripts/
│   ├── setup-wrangler.sh # Automated setup
│   └── cleanup-wrangler.sh # Cleanup script
├── .env.example          # Environment variables template
├── wrangler.toml         # Cloudflare Worker configuration
├── package.json          # Node.js dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## 🚨 Troubleshooting

### Common Issues

1. **"Not authenticated" error**
   ```bash
   npx wrangler login
   ```

2. **KV namespace not found**
   - Run the setup script again: `./scripts/setup-wrangler.sh`
   - Or manually create namespaces and update `wrangler.toml`

3. **Permission errors**
   - Ensure your Cloudflare account has Workers and KV permissions
   - Check `npx wrangler whoami` for current permissions

4. **Script permission denied**
   ```bash
   chmod +x scripts/*.sh
   ```

### Getting Help

- Check Wrangler logs: `~/.wrangler/logs/`
- View Worker logs: `npm run tail`
- Cloudflare Workers docs: https://developers.cloudflare.com/workers/

## 🔄 Workspace Management

### Creating Additional Workers

To create new Workers in this workspace:

1. Navigate to the apps directory:
   ```bash
   cd ../../  # Go to cyrus root
   ```

2. Create a new Worker:
   ```bash
   npx wrangler init apps/new-worker
   ```

3. Configure shared resources in the new worker's `wrangler.toml`

### Sharing KV Namespaces

Multiple Workers can share the same KV namespaces by using the same `id` and `preview_id` values in their `wrangler.toml` files.

---

**Built with ❤️ for the Cyrus Linear Agent project**
