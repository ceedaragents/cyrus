# How to Self-Host Cyrus

This guide walks you through setting up Cyrus on your local computer (self-hosted)

> **💡 Tip 1:** If you're using Claude, Cursor, or any AI coding agent, ask it to read this file and help you implement all the steps. Example: *"Read selfhosting/README.md and help me set up self-hosted Cyrus"*
>
> **💡 Tip 2:** Installing CLIs for all the tools you use (Linear, GitHub, Cloudflare, etc.) dramatically improves AI agents' capability to help you. Agents can interact with CLIs directly instead of requiring manual copy-paste steps.

---

## Prerequisites

**Linear workspace** with admin access (required to create OAuth apps)

### Install Tools (macOS)

```bash
# Install jq
brew install jq

# Verify
jq --version      # Should show version like jq-1.7
node --version    # Should show v18 or higher
```

---

## Step 1: Set Up Public URL (Cloudflare Tunnel)

You need a public URL so Linear can send webhooks to your local Cyrus instance.

### 2.1 Create Cloudflare Account (if needed)

1. Go to https://cloudflare.com
2. Click **Sign up**
3. Create free account
4. Verify email

### 2.2 Create Cloudflare Tunnel

1. **Log in to Cloudflare Dashboard:**
   - Go to https://one.dash.cloudflare.com/

2. **Navigate to Tunnels:**
   - In left sidebar: Click **Access**
   - Then click **Tunnels**

3. **Create New Tunnel:**
   - Click **Create a tunnel**
   - Name it: `cyrus-local`
   - Click **Save tunnel**

4. **Copy Tunnel Token:**
   - You'll see a long token starting with `eyJ...`
   - Click **Copy** or select and copy the entire token
   - **SAVE THIS** - you'll need it in Step 3

5. **Configure Public Hostname:**
   - Click **Next** or go to tunnel settings
   - Click **Public Hostname** tab
   - Click **Add a public hostname**

   Fill in:
   - **Subdomain:** `cyrus` (or whatever you want)
   - **Domain:** Select your domain from dropdown (you must add a domain to Cloudflare first)
   - **Path:** Leave empty
   - **Type:** HTTP
   - **URL:** `localhost:3456`

**Note:** You need your own domain in Cloudflare for permanent tunnels. Free `trycloudflare.com` URLs are only for temporary quick tunnels and change on restart.

6. **Save Hostname:**
   - Click **Save hostname**
   - **Copy the full public URL** (e.g., `https://cyrus.yourdomain.com`)
   - **SAVE THIS** - you'll use it in Step 3

---

## Step 2: Install Cyrus

```bash
# Install Cyrus globally
npm install -g cyrus-ai

# Run once to initialize (creates ~/.cyrus/ directory)
cyrus
```

Cyrus will start and create the configuration directory. Stop it (Ctrl+C).

### Development Mode (Optional)

If you're developing Cyrus from source and want code changes to auto-compile:

1. **Install dependencies:**

```bash
cd /path/to/cyrus
pnpm install
```

2. **Link the CLI package globally** (creates wrapper automatically):

```bash
cd apps/cli
pnpm link --global
```

This creates a wrapper that points to your local compiled code in `dist/`.

3. **Load environment variables:**

```bash
source ~/.zshrc
```

4. **Start the TypeScript watch compiler in a separate terminal:**

```bash
cd apps/cli
pnpm dev
```

Leave this terminal running in the background. It auto-compiles TypeScript files when you save changes.

5. **Start Cyrus in tmux:**

```bash
tmux kill-server  # Kill any existing sessions
tmux new-session -s cyrus
```

Inside the tmux session, run:
```bash
cyrus
```

When you make code changes, `pnpm dev` auto-compiles them. Kill the Cyrus tmux session and restart it to pick up changes.

---

## Step 3: Set Environment Variables

Export the basic environment variables:

```bash
export LINEAR_DIRECT_WEBHOOKS=true
export CYRUS_BASE_URL=https://cyrus.yourdomain.com
export CYRUS_SERVER_PORT=3456
export CLOUDFLARE_TOKEN=eyJhIjoiXXXXXXX...your_token_here...XXXXXXX
```

**Replace these values:**
- `CYRUS_BASE_URL` - Your public URL from Cloudflare Tunnel (Step 1)
- `CLOUDFLARE_TOKEN` - Your tunnel token from Cloudflare (Step 1)

**Note:** You'll add the Linear OAuth credentials in Step 4 after creating the OAuth app.

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

   **Name:**
   ```
   Cyrus
   ```

   **Description:**
   ```
   Self-hosted Cyrus agent for automated development
   ```

   **Application Icon:** (optional but recommended)
   - Upload a simple icon/logo for Cyrus
   - This is how Cyrus will appear in Linear

   **Callback URLs:**
   - Enter your Cloudflare URL from Step 1 with `/callback` at the end
   - Example: `https://cyrus.yourdomain.com/callback`

3. **Enable Client credentials** toggle

4. **Enable Webhooks** toggle

5. **Configure Webhook Settings:**

   **Webhook URL:**
   - Enter your Cloudflare URL from Step 1 with `/webhook` at the end
   - Example: `https://cyrus.yourdomain.com/webhook`

   **App events** - Check these boxes:
   - ✅ **Agent session events** (REQUIRED - makes Cyrus appear as agent)
   - ✅ **Inbox notifications** (recommended)
   - ✅ **Permission changes** (recommended)

6. Click **Save**

### 4.3 Copy OAuth Credentials

After clicking Create, the page will reload and show your new app.

**At the top of the page, you'll see:**

1. **Client ID:**
   - Long string of letters/numbers (e.g., `client_id_27653g3h4y4ght3g4`)
   - Click the copy icon or select and copy
   - **SAVE THIS IMMEDIATELY**

2. **Client Secret:**
   - Another long string (e.g., `client_secret_shgd5a6jdk86823h`)
   - Click **Show** if hidden
   - Click the copy icon or select and copy
   - **SAVE THIS IMMEDIATELY** - may only be shown once!

**Keep these values - you'll update your shell profile in the next step**

### 4.5 Set Linear OAuth Environment Variables

Still on the OAuth app page, find the webhook secret (labeled "Signing secret").

**Now export all three OAuth credentials:**

```bash
export LINEAR_CLIENT_ID=client_id_27653g3h4y4ght3g4
export LINEAR_CLIENT_SECRET=client_secret_shgd5a6jdk86823h
export LINEAR_WEBHOOK_SECRET=lin_whs_s56dlmfhg72038474nmfojhsn7
```

Replace with your actual values from the Linear OAuth app page.

---

## Step 5: Start Cyrus

Cyrus will automatically start the Cloudflare tunnel using the `CLOUDFLARE_TOKEN` environment variable.

```bash
cyrus
```

You'll see Cyrus start up and show logs. Cyrus will automatically start the Cloudflare tunnel in the background.

---

## Step 6: Authorize Cyrus with Linear

Run the authorization script:

```bash
./selfhosting/cyrus-agent-auth.sh
```

This will automatically open your browser to the Linear OAuth authorization page. Click **Authorize** when prompted.

Linear will redirect back to Cyrus and you'll see "Authorization successful!" in your browser.

---

## Step 7: Add Repository

Edit `~/.cyrus/config.json` and add your repository details.

For detailed repository configuration options and setup scripts, see the [Repository Setup Script](../README.md#repository-setup-script) section in the main README.

Simple example:

```json
{
  "repositories": [{
    "name": "my-app",
    "repositoryPath": "/Users/you/code/my-app",
    "baseBranch": "main"
  }]
}
```

Cyrus will automatically reload and pick up the new repository.
