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

Check if pm2 is installed:

```bash
which pm2
```

If not installed:

```bash
npm install -g pm2
```

Start Cyrus with pm2:

```bash
pm2 start cyrus --name cyrus
```

Enable auto-start on boot:

```bash
pm2 save
pm2 startup
```

The `pm2 startup` command will print a command to run — tell the user to run it.

Useful commands to mention:

```bash
pm2 logs cyrus    # View logs
pm2 restart cyrus # Restart
pm2 stop cyrus    # Stop
```

### Option 2: systemd (Linux only)

Create the service file:

```bash
sudo tee /etc/systemd/system/cyrus.service > /dev/null << 'EOF'
[Unit]
Description=Cyrus AI Agent
After=network.target

[Service]
Type=simple
User=$USER
EnvironmentFile=%h/.cyrus/.env
ExecStart=$(which cyrus)
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

Note: substitute `$USER` and `$(which cyrus)` with actual values before writing.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cyrus
sudo systemctl start cyrus
```

Useful commands to mention:

```bash
sudo systemctl status cyrus   # Check status
sudo journalctl -u cyrus -f   # View logs
sudo systemctl restart cyrus   # Restart
```

### Option 3: Foreground

Just run:

```bash
cyrus
```

## Step 4: Start ngrok (if applicable)

If the user configured ngrok in the endpoint step, remind them:

> **Start ngrok before or alongside Cyrus** so webhooks can reach your instance:
> ```bash
> ngrok start cyrus
> ```
>
> If using pm2, you can also add ngrok:
> ```bash
> pm2 start "ngrok start cyrus" --name ngrok
> pm2 save
> ```

## Step 5: Verify Running

Once Cyrus starts, verify it's listening:

```bash
curl -s http://localhost:3456/status
```

Should return `{"status":"idle"}` or similar.

> Then try assigning a Linear issue to Cyrus, or @mentioning it in Slack, to verify the full pipeline works!

## Completion

> ✓ Cyrus is running and ready. Assign a Linear issue or @mention in Slack to test it out!
