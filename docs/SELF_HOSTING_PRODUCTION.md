# Production Self-Hosting Guide (Caddy + pm2)

This guide walks you through a production-grade self-hosted Cyrus deployment on a Linux VPS or dedicated server using:

- **Claude Code** — AI assistant that reads this file and walks you through setup interactively
- **zsh + Oh My Zsh** — comfortable shell for managing the server *(optional but recommended)*
- **mise** — per-project runtime version manager for Node.js *(optional — skip if you manage Node.js another way)*
- **pm2** — process manager for keeping Cyrus and the dashboard alive
- **Caddy** — reverse proxy with automatic HTTPS

> This is a companion to [SELF_HOSTING.md](./SELF_HOSTING.md), which covers the Linear OAuth and repository setup steps.

---

## The Easy Way: Let Claude Code Set This Up For You

Instead of following every step manually, install Claude Code and have it read this file and execute the steps for you interactively.

### Step 0 — Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Authenticate with your Anthropic account:

```bash
claude
```

This opens a browser to log in. Once authenticated, Claude Code is ready.

> **No Anthropic account yet?** Sign up at https://claude.ai — the Claude Code CLI is included with Claude Pro and Max subscriptions.

### Hand Off to Claude Code

Once Claude Code is installed, run it inside the cloned Cyrus repo and hand it this file:

```bash
# Clone the repo first (if you haven't already)
git clone https://github.com/andychongyz/cyrus.git && cd cyrus

# Start Claude Code and give it the mission
claude
```

Then paste this into Claude Code:

```
Read docs/SELF_HOSTING_PRODUCTION.md and help me set up self-hosted Cyrus step by step on this server.
Ask me for any values you need (domain name, API keys, etc.) as we go.
```

Claude Code will read this file, check what's already installed, ask for missing values, and run each command for you. It will also stop pm2 before the Linear OAuth step and restart it afterwards automatically.

---

## Manual Setup (reference)

Follow the steps below if you prefer to set things up yourself, or to understand what Claude Code is doing.

---

## Overview

By the end of this guide you'll have:

```
Internet
    ↓ HTTPS (443)
Caddy  (automatic TLS, reverse proxy)
    ├── yourdomain.com/dashboard → Cyrus Dashboard (port 3457)
    ├── yourdomain.com/api/*     → Cyrus Dashboard (port 3457)
    └── yourdomain.com/          → Cyrus API (port 3456)

pm2
    ├── cyrus            (cyrus process)
    └── cyrus-dashboard  (dashboard backend)
```

---

## Step 1: Install zsh and Oh My Zsh

A better shell makes server management a lot more pleasant — syntax highlighting, git status in the prompt, and autocompletion out of the box.

```bash
# Install zsh
sudo apt install -y zsh

# Make zsh the default shell for your user
chsh -s $(which zsh)

# Install Oh My Zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

Log out and back in (or open a new shell session) for the change to take effect. All subsequent steps assume zsh — if you skip this, replace `~/.zshrc` with `~/.bashrc` in the commands below.

> **Optional:** Skip this step if you already have a preferred shell set up.

---

## Step 2: Install Node.js (LTS) via mise

[mise](https://mise.jdx.dev) is a fast, single-binary runtime version manager that makes it easy to install and switch Node.js versions per project.

```bash
curl https://mise.run | sh
```

Add mise to your shell profile:

```bash
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

Install the latest LTS version of Node.js:

```bash
mise use --global node@lts

# Verify
node --version   # e.g. v22.x.x
npm --version
```

> **Tip:** To pin a specific version inside a project, run `mise use node@22` there. mise creates a `.mise.toml` file that locks the version for that directory.

> **Optional:** If you already have Node.js installed and don't need version switching, skip mise. Make sure `node --version` shows v18 or higher before continuing.

---

## Step 3: Install pm2 and system dependencies

```bash
npm install -g pm2

# Required for Claude Code parsing
sudo apt install -y jq gh git
```

---

## Step 4: Install dependencies and build Cyrus

Install `pnpm` (the monorepo package manager) and `tsx` (TypeScript executor for the dashboard backend):

```bash
npm install -g pnpm tsx
```

Then install all monorepo dependencies and build every package:

```bash
cd /path/to/cyrus
pnpm install
pnpm build
```

> **Note:** `pnpm build` at the root compiles all workspace packages (including `cyrus-core` and others that the dashboard depends on) before building the apps. The dashboard build in Step 6 will fail if this step is skipped.

---

## Step 5: Install and configure Caddy

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Configure Caddy

Edit `/etc/caddy/Caddyfile`:

```
yourdomain.com {
    # ── Cyrus Dashboard UI (/dashboard) ──────────────────────────────────────
    # Strip the /dashboard prefix before forwarding to the dashboard backend.
    # The dashboard backend serves the React app at / and its API at /api/*.
    handle /dashboard* {
        uri strip_prefix /dashboard
        reverse_proxy localhost:3457
    }

    # ── Dashboard API calls (/api/*) ──────────────────────────────────────────
    # The dashboard frontend uses root-relative /api/* paths (e.g. /api/config,
    # /api/dashboard-config). Without this block they would fall through to the
    # Cyrus agent and fail.
    handle /api/* {
        reverse_proxy localhost:3457
    }

    # ── Cyrus agent (webhooks, /status, /version, etc.) ──────────────────────
    handle {
        reverse_proxy localhost:3456
    }
}
```

Replace `yourdomain.com` with your actual domain. Caddy provisions a Let's Encrypt TLS certificate automatically on first request.

Apply the config:

```bash
sudo systemctl reload caddy
```

> **No domain yet?** Use Caddy's local HTTPS for testing:
> ```
> :443 {
>     handle /dashboard* {
>         uri strip_prefix /dashboard
>         reverse_proxy localhost:3457
>     }
>     handle /api/* {
>         reverse_proxy localhost:3457
>     }
>     handle {
>         reverse_proxy localhost:3456
>     }
> }
> ```

---

## Step 6: Build the dashboard for production

The dashboard frontend must be built with the `/dashboard/` base path so asset URLs match what Caddy serves.

> **Prerequisite:** Run `pnpm build` from the monorepo root (Step 4) before this step. The dashboard depends on workspace packages that must be compiled first.

```bash
cd /path/to/cyrus/apps/dashboard

# Build with the /dashboard/ base path baked in
VITE_BASE_PATH=/dashboard/ pnpm build
```

The built files land in `apps/dashboard/dist/`. The Express backend (`server.ts`) serves them automatically.

---

## Step 7: Complete your environment file

Your `~/.cyrus/.env` should contain (refer to [SELF_HOSTING.md](./SELF_HOSTING.md) for how to get these values):

```bash
# Server configuration
LINEAR_DIRECT_WEBHOOKS=true
CYRUS_BASE_URL=https://yourdomain.com
CYRUS_SERVER_PORT=3456

# Linear OAuth
LINEAR_CLIENT_ID=your_client_id
LINEAR_CLIENT_SECRET=your_client_secret
LINEAR_WEBHOOK_SECRET=your_webhook_secret

# Claude Code authentication (choose one)
ANTHROPIC_API_KEY=your-api-key
# or: CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token

# Dashboard auth key (set a strong random string)
CYRUS_API_KEY=your-random-api-key
```

---

## Step 8: Authorize with Linear

**Important:** The OAuth callback flow (`cyrus self-auth`) needs to bind to port 3456 directly. If pm2 is already running a Cyrus process on that port, the auth will fail. Stop pm2 first.

```bash
# Stop pm2 if it's already running Cyrus
pm2 stop cyrus 2>/dev/null || true

# Run the OAuth authorization flow
cyrus self-auth
```

This will:
1. Start a temporary HTTP server on port 3456
2. Print a Linear authorization URL — open it in your browser
3. After you click **Authorize**, Linear redirects to `https://yourdomain.com/callback`
4. Caddy forwards `/callback` to Cyrus on port 3456
5. Cyrus saves the tokens to `~/.cyrus/config.json` and exits

Once authorization completes, restart pm2:

```bash
pm2 restart cyrus 2>/dev/null || true
```

---

## Step 9: Add repositories

```bash
cyrus self-add-repo https://github.com/yourorg/yourrepo.git
```

For multiple workspaces:

```bash
cyrus self-add-repo https://github.com/yourorg/yourrepo.git "My Workspace"
```

---

## Step 10: Start Cyrus and the dashboard with pm2

### Create pm2 ecosystem file

Create `~/cyrus-pm2.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "cyrus",
      script: "/path/to/cyrus/apps/cli/dist/src/app.js",
      interpreter: "node",
      env_file: "/root/.cyrus/.env",
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "cyrus-dashboard",
      script: "tsx",
      args: "/path/to/cyrus/apps/dashboard/server.ts",
      env_file: "/root/.cyrus/.env",
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
```

Replace `/path/to/cyrus` with the actual path to your Cyrus repository (e.g. `/root/cyrus-fork`).

### Start both processes

```bash
pm2 start ~/cyrus-pm2.config.cjs
```

### Save and enable startup

```bash
pm2 save
pm2 startup
# Run the command that pm2 prints (it starts with sudo env PATH=...)
```

pm2 will now restart both processes automatically on server reboot.

---

## Verifying the setup

```bash
# Check both processes are running
pm2 status

# Tail logs
pm2 logs cyrus
pm2 logs cyrus-dashboard

# Test the Cyrus API
curl https://yourdomain.com/status

# Test the dashboard backend
curl https://yourdomain.com/dashboard/api/config
```

Open `https://yourdomain.com/dashboard` in your browser — you should see the Cyrus Dashboard connect screen.

---

## Useful pm2 commands

```bash
pm2 status                    # Show all processes
pm2 logs                      # Stream all logs
pm2 logs cyrus                # Stream Cyrus logs only
pm2 logs cyrus-dashboard      # Stream dashboard logs only
pm2 restart cyrus             # Restart Cyrus
pm2 restart cyrus-dashboard   # Restart the dashboard
pm2 stop cyrus                # Stop Cyrus (needed before re-authorizing with Linear)
pm2 reload all                # Zero-downtime reload
pm2 monit                     # Real-time monitoring dashboard (terminal)
```

---

## Re-authorizing with Linear

If your Linear tokens expire or you need to re-run the OAuth flow:

```bash
# 1. Stop Cyrus so port 3456 is free
pm2 stop cyrus

# 2. Run the auth flow
cyrus self-auth

# 3. Restart after authorization completes
pm2 start cyrus
```

---

## Updating Cyrus

```bash
cd /path/to/cyrus

# Pull latest changes
git pull

# Reinstall dependencies and rebuild all packages
pnpm install
pnpm build

# Rebuild the dashboard frontend with the /dashboard/ base path
cd apps/dashboard
VITE_BASE_PATH=/dashboard/ pnpm build

# Restart both pm2 processes
pm2 restart all
```

---

## Troubleshooting

**`cyrus self-auth` fails with "address already in use"**
Port 3456 is taken. Run `pm2 stop cyrus` before authorizing.

**Dashboard shows blank page at `/dashboard`**
The frontend was built without `VITE_BASE_PATH=/dashboard/`. Rebuild:
```bash
cd apps/dashboard && VITE_BASE_PATH=/dashboard/ pnpm build
pm2 restart cyrus-dashboard
```

**Caddy returns 502 Bad Gateway**
One of the backends isn't running. Check `pm2 status` and `pm2 logs`.

**HTTPS certificate not issuing**
Make sure port 80 and 443 are open in your firewall and that `yourdomain.com` points to your server's IP. Caddy handles Let's Encrypt automatically once DNS resolves.

**Dashboard pages load but API calls fail / "Failed to save dashboard config"**
The `/api/*` Caddy block is missing or mis-ordered. The dashboard frontend uses root-relative `/api/` paths (e.g. `/api/dashboard-config`, `/api/config`) that bypass the `/dashboard*` handle block and fall through to the Cyrus agent. Add a `handle /api/* { reverse_proxy localhost:3457 }` block between the `/dashboard*` block and the catch-all, then `sudo systemctl reload caddy`.

**Linear webhooks not received**
- Check `CYRUS_BASE_URL` in `~/.cyrus/.env` matches your domain exactly
- Verify Caddy is forwarding non-`/dashboard` paths to port 3456: `curl https://yourdomain.com/status`
- Check Cyrus logs: `pm2 logs cyrus`
