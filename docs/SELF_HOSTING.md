# Self-Hosting Cyrus

This guide walks you through setting up Cyrus on your local computer or server (self-hosted).

> **Tip:** If you're using Claude, Cursor, or any AI coding agent, ask it to read this file and help you implement all the steps. Example: *"Read docs/SELF_HOSTING.md and help me set up self-hosted Cyrus"*

---

## Prerequisites

- **Linear workspace** with admin access (required to create OAuth apps)
- **Node.js** v18 or higher
- **jq** (for Claude Code parsing)

### Install Tools (macOS)

```bash
# Install jq
brew install jq

# Verify
jq --version      # Should show version like jq-1.7
node --version    # Should show v18 or higher
```

### Install Tools (Linux/Ubuntu)

For remote servers or VPS instances:

```bash
# Install required packages
apt install -y gh npm git jq

# Verify installations
jq --version      # Should show version like jq-1.7
node --version    # Should show v18 or higher
gh --version      # GitHub CLI
```

---

## Overview

Self-hosting Cyrus requires:

1. A public URL for Linear webhooks (choose one option below)
2. A Linear OAuth application
3. Cyrus installed and configured

### Public URL Options

Linear needs to send webhooks to your Cyrus instance. Choose one:

| Option | Best For | Persistence |
|--------|----------|-------------|
| [Cloudflare Tunnel](./CLOUDFLARE_TUNNEL.md) | Production self-hosting | Permanent URL |
| ngrok | Development/testing | Changes on restart |
| Public server/domain | VPS or cloud hosting | Permanent URL |
| Reverse proxy (nginx/caddy) | Existing infrastructure | Permanent URL |

---

## Step 1: Install Cyrus

```bash
# Install Cyrus globally
npm install -g cyrus-ai

# Run once to initialize (creates ~/.cyrus/ directory)
cyrus
```

Cyrus will start and create the configuration directory. Stop it (Ctrl+C).

### Development Mode (Optional)

If you're developing Cyrus from source:

1. **Install dependencies:**

```bash
cd /path/to/cyrus
pnpm install
```

2. **Link the CLI package globally:**

```bash
cd apps/cli
pnpm link --global
```

3. **Start the TypeScript watch compiler in a separate terminal:**

```bash
cd apps/cli
pnpm dev
```

4. **Start Cyrus:**

```bash
cyrus
```

---

## Step 2: Set Up Public URL

Choose your preferred method from the options above. You'll need:

- A public URL (e.g., `https://cyrus.yourdomain.com`)
- The URL must be accessible from the internet

For Cloudflare Tunnel setup, see [Cloudflare Tunnel Guide](./CLOUDFLARE_TUNNEL.md).

---

## Step 3: Set Environment Variables

Export the basic environment variables:

```bash
export LINEAR_DIRECT_WEBHOOKS=true
export CYRUS_BASE_URL=https://your-public-url.com
export CYRUS_SERVER_PORT=3456
```

**Replace:**
- `CYRUS_BASE_URL` - Your public URL from Step 2

If using Cloudflare Tunnel, also set:
```bash
export CLOUDFLARE_TOKEN=eyJhIjoiXXXXXXX...your_token_here...XXXXXXX
```

---

## Step 4: Create Linear OAuth Application

**IMPORTANT:** You must be a **workspace admin** in Linear to create OAuth apps.

### 4.1 Open Linear Settings

1. Go to Linear: https://linear.app
2. Click your workspace name (top-left corner)
3. Click **Settings** in the dropdown
4. In the left sidebar, scroll down to **Account** section
5. Click **API**
6. Scroll down to **OAuth Applications** section

### 4.2 Create New Application

1. Click **Create new OAuth Application** button

2. Fill in the form:

   **Name:** `Cyrus`

   **Description:** `Self-hosted Cyrus agent for automated development`

   **Callback URLs:** `https://your-public-url.com/callback`

3. **Enable Client credentials** toggle

4. **Enable Webhooks** toggle

5. **Configure Webhook Settings:**

   **Webhook URL:** `https://your-public-url.com/webhook`

   **App events** - Check these boxes:
   - **Agent session events** (REQUIRED - makes Cyrus appear as agent)
   - **Inbox notifications** (recommended)
   - **Permission changes** (recommended)

6. Click **Save**

### 4.3 Copy OAuth Credentials

After saving, copy these values from the app page:

1. **Client ID** - Long string like `client_id_27653g3h4y4ght3g4`
2. **Client Secret** - Another long string (may only be shown once!)
3. **Webhook Signing Secret** - Found in webhook settings

### 4.4 Set Linear OAuth Environment Variables

```bash
export LINEAR_CLIENT_ID=client_id_27653g3h4y4ght3g4
export LINEAR_CLIENT_SECRET=client_secret_shgd5a6jdk86823h
export LINEAR_WEBHOOK_SECRET=lin_whs_s56dlmfhg72038474nmfojhsn7
```

---

## Step 5: Start Cyrus

```bash
cyrus
```

You'll see Cyrus start up and show logs. If using Cloudflare Tunnel, it will automatically start in the background.

---

## Step 6: Authorize Cyrus with Linear

Run the authorization command:

```bash
cyrus self-auth
```

This will:
1. Open your browser to Linear's OAuth authorization page
2. After you click **Authorize**, redirect back to Cyrus
3. Save the tokens to your config

---

## Step 7: Add Repository

Add a repository using the CLI:

```bash
cyrus self-add-repo https://github.com/yourorg/yourrepo.git
```

This clones the repository to `~/.cyrus/repos/` and adds it to your config with the Linear workspace credentials.

If you have multiple Linear workspaces, specify which one:

```bash
cyrus self-add-repo https://github.com/yourorg/yourrepo.git "My Workspace"
```

Cyrus will automatically pick up the new repository.

---

## Configuration

For detailed configuration options, see [Configuration File Reference](./CONFIG_FILE.md).

---

## Remote Server Setup

If you're setting up Cyrus on a remote VPS or cloud VM for 24/7 availability, follow these additional steps.

### 1. Set Up Git SSH Keys

```bash
ssh-keygen
# Follow the prompts, then paste the public key into GitHub

git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 2. Authenticate GitHub CLI

```bash
gh auth login
# Follow prompts to authenticate with a token
```

### 3. Install and Authenticate Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

**Authentication Options** (choose one):

**Option A: API Key** (recommended for self-hosting)
```bash
export ANTHROPIC_API_KEY=your-api-key
```
Get your API key from the [Anthropic Console](https://console.anthropic.com/).

**Option B: OAuth Token** (for subscription users)
```bash
claude setup-token
# Follow prompts, then set:
export CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token
```

**Option C: Third-Party Providers**

For Vertex AI, Azure, AWS Bedrock, and other providers, see the [Third-Party Integrations](https://docs.anthropic.com/en/docs/claude-code/bedrock-vertex) documentation.

### 4. Clone Your Repository

```bash
git clone git@github.com:your-org/your-repo.git
```

### 5. Create Environment File

Create an environment file with your configuration:

```bash
# Server configuration
CYRUS_SERVER_PORT=3456

# Base URL configuration (required for Linear integration)
CYRUS_BASE_URL=<your publicly accessible URL>

# Linear OAuth configuration (for self-hosted)
LINEAR_DIRECT_WEBHOOKS=true
LINEAR_CLIENT_ID=<your Linear OAuth app client ID>
LINEAR_CLIENT_SECRET=<your Linear OAuth app client secret>
LINEAR_WEBHOOK_SECRET=<your Linear webhook secret>
```

Start Cyrus with the environment file:

```bash
cyrus --env-file=/path/to/env-file
```

---

## Running as a Service

For 24/7 availability, run Cyrus in a persistent session:

### Using tmux

```bash
tmux new-session -s cyrus
cyrus
# Ctrl+B, D to detach
# tmux attach -t cyrus to reattach
```

### Using systemd (Linux)

Create `/etc/systemd/system/cyrus.service`:

```ini
[Unit]
Description=Cyrus AI Agent
After=network.target

[Service]
Type=simple
User=your-user
Environment=LINEAR_DIRECT_WEBHOOKS=true
Environment=CYRUS_BASE_URL=https://your-url.com
Environment=CYRUS_SERVER_PORT=3456
Environment=LINEAR_CLIENT_ID=your_client_id
Environment=LINEAR_CLIENT_SECRET=your_client_secret
Environment=LINEAR_WEBHOOK_SECRET=your_webhook_secret
ExecStart=/usr/local/bin/cyrus
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable cyrus
sudo systemctl start cyrus
```

---

## Troubleshooting

### OAuth Authorization Fails

- Verify `CYRUS_BASE_URL` matches your Linear OAuth callback URL exactly
- Check that your public URL is accessible from the internet
- Ensure all three Linear environment variables are set

### Webhooks Not Received

- Verify Linear webhook URL matches `CYRUS_BASE_URL/webhook`
- Check Cyrus logs for incoming webhook attempts
- Ensure your public URL is accessible

### Repository Not Processing

- Check that the repository is in your config (`~/.cyrus/config.json`)
- Verify Linear tokens are valid with `cyrus check-tokens`
- Ensure the issue is assigned to Cyrus in Linear
