---
name: cyrus-setup-launch
description: Print a summary of the Cyrus setup and offer to start the agent.
---

**CRITICAL: Never use `Read`, `Edit`, or `Write` tools on `~/.cyrus/.env` or any file inside `~/.cyrus/`. Use only `Bash` commands (`grep`, `printf >>`, etc.) to interact with env files — secrets must never be read into the conversation context.**

# Setup Launch

Prints a summary of the completed setup and offers to start Cyrus.

## Step 1: Gather Configuration

Read current state:

```bash
# Base URL
grep '^CYRUS_BASE_URL=' ~/.cyrus/.env 2>/dev/null | cut -d= -f2-

# Linear
grep -c '^LINEAR_CLIENT_ID=' ~/.cyrus/.env 2>/dev/null

# GitHub
gh auth status 2>&1 | head -1

# Slack
grep -c '^SLACK_BOT_TOKEN=' ~/.cyrus/.env 2>/dev/null

# Repositories
cat ~/.cyrus/config.json 2>/dev/null

# Claude auth
grep -c -E '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=' ~/.cyrus/.env 2>/dev/null
```

## Step 2: Print Summary

Print a formatted summary:

```
┌─────────────────────────────────────┐
│         Cyrus Setup Complete        │
├─────────────────────────────────────┤
│                                     │
│  Endpoint: https://your-url.com     │
│  Claude:   ✓ API key configured     │
│                                     │
│  Surfaces:                          │
│    Linear:  ✓ Workspace connected   │
│    GitHub:  ✓ CLI authenticated     │
│    Slack:   ✓ Bot configured        │
│                                     │
│  Repositories:                      │
│    • yourorg/yourrepo               │
│    • yourorg/another-repo           │
│                                     │
└─────────────────────────────────────┘
```

Use ✓ for configured items and ✗ for skipped/unconfigured items.

## Step 3: Make Cyrus Persistent

Cyrus needs to run as a background process so it stays alive and restarts after reboots. **Use the `AskUserQuestion` tool if available** to ask:

> **How would you like to keep Cyrus running in the background?**
>
> 1. **pm2** (recommended) — Node.js process manager. Simple to set up, auto-restarts on crash, log management built in. Best for most users.
> 2. **systemd** (Linux only) — OS-level service manager. Starts on boot automatically, managed with `systemctl`. Best for dedicated Linux servers.
> 3. **Neither** — just run `cyrus` in the foreground for now (you can set up persistence later).

### Option 1: pm2

The agent should run all of these commands directly:

1. Check if pm2 is installed (`which pm2`). If not, install it (`npm install -g pm2`).
2. Start Cyrus: `pm2 start cyrus --name cyrus`
3. Save the process list: `pm2 save`
4. Run `pm2 startup` — this prints a system-specific command. The agent should run that output command too (it typically requires `sudo`).

After setup, inform the user of useful commands:
- `pm2 logs cyrus` — view logs
- `pm2 restart cyrus` — restart
- `pm2 stop cyrus` — stop

### Option 2: systemd (Linux only)

The agent should run all of these commands directly:

1. Resolve the actual values for the service file:
   ```bash
   CYRUS_BIN=$(which cyrus)
   CYRUS_USER=$(whoami)
   ```

2. Write the service file:
   ```bash
   sudo tee /etc/systemd/system/cyrus.service > /dev/null << EOF
   [Unit]
   Description=Cyrus AI Agent
   After=network.target

   [Service]
   Type=simple
   User=$CYRUS_USER
   EnvironmentFile=/home/$CYRUS_USER/.cyrus/.env
   ExecStart=$CYRUS_BIN
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   EOF
   ```

3. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable cyrus
   sudo systemctl start cyrus
   ```

After setup, inform the user of useful commands:
- `sudo systemctl status cyrus` — check status
- `sudo journalctl -u cyrus -f` — view logs
- `sudo systemctl restart cyrus` — restart

### Option 3: Foreground

Run directly:

```bash
cyrus
```

## Step 4: Start ngrok (if applicable)

If the user configured ngrok in the endpoint step, the agent should start it:

```bash
ngrok start cyrus
```

If using pm2, also make ngrok persistent:

```bash
pm2 start "ngrok start cyrus" --name ngrok
pm2 save
```

## Step 5: Sandbox CA Certificate Trust (if sandbox enabled)

If the user's `~/.cyrus/config.json` has `sandbox.enabled: true`, check whether the egress proxy CA certificate is trusted in the system keychain.

**Check if sandbox is enabled:**

```bash
grep -o '"enabled":\s*true' ~/.cyrus/config.json 2>/dev/null | head -1
```

If sandbox is enabled, check trust status:

```bash
# macOS — check System keychain for the Cyrus CA
security find-certificate -c "Cyrus Egress Proxy CA" /Library/Keychains/System.keychain 2>&1
```

- If the cert is found (exit code 0): report ✓ trusted, no action needed.
- If not found (exit code 44): inform the user and offer to run the trust command:

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.cyrus/certs/cyrus-egress-ca.pem
```

On Linux:

```bash
sudo cp ~/.cyrus/certs/cyrus-egress-ca.pem /usr/local/share/ca-certificates/cyrus-egress-ca.crt
sudo update-ca-certificates
```

**Note:** System-wide trust is optional — Cyrus automatically sets `NODE_EXTRA_CA_CERTS`, `GIT_SSL_CAINFO`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `PIP_CERT` per-session for agent subprocesses. System-wide trust only matters for tools that use the OS certificate store directly (e.g., curl on macOS).

## Step 6: Verify Running

Once Cyrus starts, verify it's listening:

```bash
curl -s http://localhost:3456/status
```

Should return `{"status":"idle"}` or similar.

> Then try assigning a Linear issue to Cyrus, or @mentioning it in Slack, to verify the full pipeline works!

## Completion

> ✓ Cyrus is running and ready. Assign a Linear issue or @mention in Slack to test it out!
