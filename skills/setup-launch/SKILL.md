---
name: setup-launch
description: Print a summary of the Cyrus setup and offer to start the agent.
---

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

## Step 3: Start Cyrus

Ask the user:

> **Ready to start Cyrus?**
>
> For a quick test:
> ```bash
> cyrus
> ```
>
> For persistent background operation:
> ```bash
> # Using tmux
> tmux new-session -d -s cyrus 'cyrus'
>
> # Using pm2
> pm2 start cyrus --name cyrus
>
> # Using screen
> screen -dmS cyrus cyrus
> ```

If using ngrok, remind them:

> **Don't forget to start ngrok first** (in a separate terminal):
> ```bash
> ngrok start cyrus
> ```

If the user wants to start now, run:

```bash
cyrus
```

## Step 4: Verify Running

Once Cyrus starts, look for the startup log confirming it's listening:

> Look for a log line like:
> ```
> [Server] Listening on port 3456
> ```
>
> Then try assigning a Linear issue to Cyrus to verify the full pipeline works!

## Completion

> ✓ Cyrus is ready. Assign a Linear issue to test it out!
