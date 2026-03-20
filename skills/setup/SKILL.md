---
name: setup
description: Set up Cyrus - the AI background agent that runs Claude Code from Linear, Slack, and GitHub. Guides through endpoint, Linear, GitHub, and Slack configuration.
argument-hint: [--resume]
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

# Cyrus Setup

You are guiding the user through setting up Cyrus, an AI background agent that runs Claude Code from any surface -- Linear, Slack, and GitHub. This is the interactive equivalent of `cyrus setup` and the docs at `docs/SELF_HOSTING.md`.

Your job is to walk the user through each step clearly, collect credentials, write the `~/.cyrus/.env` file, and verify the setup works.

## Resume Support

Check `$ARGUMENTS` for the `--resume` flag. If present:
1. Read the existing `~/.cyrus/.env` file
2. Parse which variables are already set (non-empty, not placeholder)
3. Show the user a summary of what is already configured
4. Skip to the first uncompleted step
5. Continue from there

## Before You Begin

Read `~/.cyrus/.env` if it exists. Parse all existing values. Show the user what is already configured vs what still needs to be set up. This avoids re-doing work.

Also check if `cyrus-ai` is installed globally:
```bash
npm list -g cyrus-ai 2>/dev/null || echo "NOT_INSTALLED"
```

---

## Step 1: Welcome and Overview

Present this welcome message:

```
Welcome to Cyrus Setup

Cyrus is an AI background agent that runs Claude Code from any surface:
  - Linear: Assign issues to Cyrus and it writes code, creates PRs
  - Slack: Chat with Cyrus in channels or DMs
  - GitHub: Trigger Cyrus from issue comments or PR reviews

This setup will walk you through:
  1. Prerequisites check
  2. Directory setup
  3. Claude Code access (required)
  4. Public endpoint for webhooks (required)
  5. Linear integration (optional)
  6. GitHub integration (optional)
  7. Slack integration (optional)
  8. Repository configuration (optional)

Each step can be skipped by saying "skip". Let's get started.
```

---

## Step 2: Prerequisites Check

Verify the following are installed. For each one, run the check command and report pass/fail:

| Prerequisite | Check Command | Minimum Version |
|---|---|---|
| Node.js | `node --version` | v20.0.0 or higher |
| Git | `git --version` | Any |
| jq | `jq --version` | Any |
| Claude Code CLI | `claude --version` | Any |
| GitHub CLI | `gh --version` | Any (optional but recommended) |

For any missing prerequisite, provide the install command:
- **Node.js**: `brew install node` (macOS) or see https://nodejs.org
- **jq**: `brew install jq` (macOS) or `apt install jq` (Linux)
- **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code`
- **GitHub CLI**: `brew install gh` (macOS) or `apt install gh` (Linux)

If Node.js is missing or below v20, stop and help the user install it before continuing. The other tools can be installed later but warn about what will not work without them.

---

## Step 3: Install Cyrus and Directory Setup

### 3a: Install cyrus-ai globally

If not already installed:
```bash
npm install -g cyrus-ai
```

Verify installation:
```bash
cyrus --version
```

If the user prefers to run from source, skip the global install and note that they can use `pnpm link --global` from the `apps/cli` directory.

### 3b: Ensure directory structure

```bash
mkdir -p ~/.cyrus
```

Tell the user: "Cyrus stores its configuration in `~/.cyrus/`. This includes your `.env` file, `config.json`, cloned repositories, and worktrees."

---

## Step 4: Claude Code Access (Required)

Claude Code credentials are required for Cyrus to function. Present these options:

**Option A: Anthropic API Key (recommended)**
1. Go to https://console.anthropic.com/
2. Create or copy an API key
3. Ask: "Please paste your Anthropic API key:"

**Option B: Claude Code OAuth Token (for Max subscription users)**
1. Run `claude setup-token` on a machine where Claude Code is already authenticated
2. Ask: "Please paste your OAuth token:"

**Option C: Third-Party Provider (Vertex AI, Bedrock, Azure)**
1. Tell the user to refer to https://docs.anthropic.com/en/docs/claude-code/bedrock-vertex
2. Ask which provider they are using and capture the relevant environment variables

Save whichever credential they provide. At least one of `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` must be set.

IMPORTANT: Never guess, generate, or fabricate API keys or tokens. Always ask the user to paste the real value.

---

## Step 5: Endpoint Configuration (Required)

Cyrus needs a publicly accessible URL so Linear, Slack, and GitHub can send webhooks to it.

Present three options:

### Option A: Cloudflare Tunnel (recommended for production)

1. Tell the user they need a Cloudflare account and a domain added to Cloudflare
2. Walk them through creating a tunnel:
   - Go to https://one.dash.cloudflare.com/
   - Navigate to Access > Tunnels
   - Create a new tunnel named `cyrus-local`
   - Copy the tunnel token (starts with `eyJ...`)
   - Configure a public hostname pointing to `localhost:3456`
3. Ask: "Please paste your Cloudflare tunnel token:"
4. Ask: "What is your public URL? (e.g., https://cyrus.yourdomain.com)"
5. Save `CLOUDFLARE_TOKEN` and `CYRUS_BASE_URL`

### Option B: ngrok (good for development/testing)

1. Tell the user to install ngrok: `brew install ngrok` or https://ngrok.com/download
2. Tell them to authenticate: `ngrok config add-authtoken <token>`
3. They will start it separately: `ngrok http 3456`
4. Ask: "What is your ngrok public URL? (e.g., https://abc123.ngrok-free.app)"
5. Save `CYRUS_BASE_URL`
6. Warn: "Note: ngrok URLs change on restart unless you have a paid plan. You will need to update your Linear webhook URL each time."

### Option C: Custom URL

1. Ask: "What is your public URL where Cyrus will be reachable?"
2. Save `CYRUS_BASE_URL`

Always set `CYRUS_SERVER_PORT=3456` regardless of endpoint choice.

---

## Step 6: Linear Integration (Optional)

Ask: "Would you like to set up Linear integration? This lets you assign issues to Cyrus in Linear. (yes/skip)"

If the user wants to set up Linear:

### 6a: Create Linear OAuth Application

Walk them through step by step:

1. "Go to Linear: https://linear.app"
2. "Click your workspace name (top-left) > Settings"
3. "In the left sidebar under Account, click API"
4. "Scroll down to OAuth Applications and click 'Create new OAuth Application'"
5. Fill in the form:
   - **Name**: `Cyrus`
   - **Description**: `AI background agent for automated development`
   - **Callback URLs**: `{CYRUS_BASE_URL}/callback` (use the URL from Step 5)
6. "Enable the **Client credentials** toggle"
7. "Enable the **Webhooks** toggle"
8. Configure webhook settings:
   - **Webhook URL**: `{CYRUS_BASE_URL}/webhook`
   - Check these **App events**:
     - **Agent session events** (REQUIRED -- this is what makes Cyrus appear as an agent in Linear)
     - **Inbox notifications** (recommended)
     - **Permission changes** (recommended)
9. "Click Save"

### 6b: Collect Credentials

After the user saves:
1. Ask: "Please paste your Linear Client ID:"
2. Ask: "Please paste your Linear Client Secret:" (warn: may only be shown once)
3. Ask: "Please paste your Linear Webhook Signing Secret:" (found in webhook settings)

Save: `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`

Also set `LINEAR_DIRECT_WEBHOOKS=true` automatically.

---

## Step 7: GitHub Integration (Optional)

Ask: "Would you like to set up GitHub integration? This lets Cyrus create commits and pull requests. (yes/skip)"

If yes:

1. "The recommended approach is to authenticate with the GitHub CLI:"
   ```bash
   gh auth login
   ```
2. "Verify with:"
   ```bash
   gh auth status
   ```
3. "You should also configure your Git identity:"
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your@email.com"
   ```

If the user prefers a Personal Access Token instead:
1. "Go to https://github.com/settings/tokens"
2. "Create a new token (classic) with these scopes: `repo`, `workflow`"
3. Ask: "Please paste your GitHub token:"
4. Save `GITHUB_TOKEN`

Tell the user: "Cyrus operates with the same Git/GitHub permissions as your authenticated user. All commits and PRs will be attributed to your account."

---

## Step 8: Slack Integration (Optional)

Ask: "Would you like to set up Slack integration? This lets you chat with Cyrus in Slack channels and DMs. (yes/skip)"

If yes:

1. "Go to https://api.slack.com/apps and click 'Create New App'"
2. "Choose 'From scratch', name it 'Cyrus', and select your workspace"
3. Walk them through configuring:
   - **Bot Token Scopes** (OAuth & Permissions):
     - `app_mentions:read`
     - `channels:history`
     - `channels:read`
     - `chat:write`
     - `groups:history`
     - `groups:read`
     - `im:history`
     - `im:read`
     - `im:write`
     - `users:read`
   - **Event Subscriptions**:
     - Request URL: `{CYRUS_BASE_URL}/slack/events`
     - Subscribe to: `app_mention`, `message.im`
4. "Install the app to your workspace"
5. Ask: "Please paste your Slack Bot Token (starts with xoxb-):"
6. Ask: "Please paste your Slack Signing Secret (found in Basic Information):"
7. Save `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`

---

## Step 9: Repository Configuration (Optional)

Ask: "Would you like to add a repository now? This is where Cyrus will write code when processing issues. (yes/skip)"

If yes:

1. Ask: "What is the Git clone URL of your repository? (e.g., https://github.com/yourorg/yourrepo.git)"
2. If Linear was configured, ask: "Which Linear workspace should this repo be associated with? (press Enter for default)"
3. Run:
   ```bash
   cyrus self-add-repo <url> [workspace]
   ```
4. Verify it succeeded
5. Ask: "Would you like to add another repository? (yes/no)"
6. Repeat if yes

If Linear was not configured, tell the user: "You can add repositories later with `cyrus self-add-repo <url>` after completing Linear setup."

---

## Step 10: Write .env File

Collect all values gathered so far and write them to `~/.cyrus/.env`.

Use this template, only including sections where values were collected. Comment out any values that were not provided:

```bash
# Cyrus Configuration
# Generated by /setup on {YYYY-MM-DD}

# ── Claude Code Access (required) ────────────────────────────────
ANTHROPIC_API_KEY={value}
# CLAUDE_CODE_OAUTH_TOKEN=

# ── Endpoint Configuration ───────────────────────────────────────
CYRUS_BASE_URL={value}
CYRUS_SERVER_PORT=3456
# CLOUDFLARE_TOKEN={value}

# ── Linear Integration ───────────────────────────────────────────
# LINEAR_DIRECT_WEBHOOKS=true
# LINEAR_CLIENT_ID={value}
# LINEAR_CLIENT_SECRET={value}
# LINEAR_WEBHOOK_SECRET={value}

# ── GitHub Integration ───────────────────────────────────────────
# GITHUB_TOKEN={value}

# ── Slack Integration ────────────────────────────────────────────
# SLACK_BOT_TOKEN={value}
# SLACK_SIGNING_SECRET={value}
```

Rules for writing the .env:
- Uncomment and fill in lines where the user provided a value
- Leave lines commented out where the user skipped or did not provide a value
- If `~/.cyrus/.env` already exists, read it first and MERGE -- do not overwrite existing values that the user did not change during this session
- Show the user the final .env content (with secrets masked as `***...***`) and ask for confirmation before writing
- After writing, set file permissions: `chmod 600 ~/.cyrus/.env`

---

## Step 11: Verification

Run verification checks:

1. **Config file**: Check if `~/.cyrus/config.json` exists
2. **Token check**: If cyrus-ai is installed, run:
   ```bash
   cyrus check-tokens
   ```
3. **Endpoint reachability**: If a Cloudflare tunnel was configured, note that it will start automatically when Cyrus runs

Report results to the user.

---

## Step 12: Summary and Next Steps

Present a clear summary:

```
Setup Complete!

Configured:
  [x] Claude Code access (API key)
  [x] Endpoint: https://cyrus.yourdomain.com (Cloudflare Tunnel)
  [x] Linear integration
  [ ] GitHub integration (skipped)
  [ ] Slack integration (skipped)
  [x] Repository: yourorg/yourrepo

Configuration written to: ~/.cyrus/.env

Next steps:
  1. Start Cyrus:
       cyrus

  2. Authorize with Linear (first time only):
       cyrus self-auth

  3. Add more repositories:
       cyrus self-add-repo https://github.com/org/repo.git

  4. Run as a background service:
       tmux new-session -s cyrus "cyrus"

  5. Read the full docs:
       https://github.com/ceedaragents/cyrus
```

Use checkmarks `[x]` for completed integrations and `[ ]` for skipped ones. Tailor the next steps to what was actually configured (e.g., omit `cyrus self-auth` if Linear was skipped).

---

## Interaction Guidelines

- Be conversational but efficient. Do not dump walls of text.
- Present one step at a time. Wait for the user to complete each step before moving on.
- When asking for secrets (API keys, tokens), always ask the user to paste the value. NEVER fabricate, guess, or generate placeholder tokens.
- If the user says "skip", move to the next step immediately without further prompting.
- If the user says "back", return to the previous step.
- If something fails, diagnose the issue and offer solutions before moving on.
- Keep a running mental model of what has been configured so the summary is accurate.
- When showing masked secrets, show the first 4 and last 4 characters: `sk-a...xyz1`
