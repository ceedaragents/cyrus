---
name: setup-linear
description: Create a Linear OAuth application and configure Cyrus to use it — supports agent-browser automation or guided manual setup.
---

**CRITICAL: Never use `Read`, `Edit`, or `Write` tools on `~/.cyrus/.env` or any file inside `~/.cyrus/`. Use only `Bash` commands (`grep`, `printf >>`, etc.) to interact with env files — secrets must never be read into the conversation context.**

# Setup Linear

Creates a Linear OAuth application and configures credentials so Cyrus can receive webhooks and respond to issues.

## Step 1: Check Existing Configuration

```bash
grep -E '^LINEAR_CLIENT_ID=' ~/.cyrus/.env 2>/dev/null
```

If `LINEAR_CLIENT_ID` is already set, check if OAuth is also complete:

```bash
grep -q '"workspaces"' ~/.cyrus/config.json 2>/dev/null && echo "configured" || echo "not configured"
```

If both are set, inform the user:

> Linear is already configured. Skipping this step.
> To reconfigure, remove `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, and `LINEAR_WEBHOOK_SECRET` from `~/.cyrus/.env` and re-run.

Skip to completion.

## Step 2: Get CYRUS_BASE_URL

Read the base URL from the env file (set by `setup-endpoint`):

```bash
grep '^CYRUS_BASE_URL=' ~/.cyrus/.env | cut -d= -f2-
```

This is needed for the callback and webhook URLs.

## Step 3: Create Linear OAuth App

Check if `agent-browser` is available:

```bash
which agent-browser 2>/dev/null
```

### Path A: agent-browser Automation

If `agent-browser` is available, automate the Linear app creation:

#### 3a. Navigate to Linear API settings

```bash
agent-browser navigate "https://linear.app/settings/api/applications/new"
```

Wait for page to load. Take a screenshot to verify you're on the right page and logged in.

#### 3b. Fill the form

```bash
agent-browser fill "input[name='name']" "<AGENT_NAME>"
agent-browser fill "input[name='developerName']" "Self-hosted"
agent-browser fill "input[name='developerUrl']" "https://github.com/ceedaragents/cyrus"
```

For the callback URL field:
```bash
agent-browser fill "input[name='redirectUrls']" "<CYRUS_BASE_URL>/callback"
```

Enable webhooks and fill webhook URL:
```bash
agent-browser fill "input[name='webhookUrl']" "<CYRUS_BASE_URL>/webhook"
```

Check the required event types:
- Agent session events (REQUIRED)
- Inbox notifications
- Permission changes
- Issues

Click "Create".

#### 3c. Capture credentials via JavaScript

After creation, Linear redirects to the app settings page. Use JavaScript to extract credentials:

```bash
# Copy Client ID
agent-browser eval "var items = document.querySelectorAll('li'); var idLi; for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('Client ID') >= 0) { idLi = items[i]; break; } } if (idLi) { var btns = idLi.querySelectorAll('button'); btns[0].click(); 'clicked copy button'; } else { 'not found'; }"
CLIENT_ID=$(pbpaste)

# Copy Client Secret
agent-browser eval "var items = document.querySelectorAll('li'); var secretLi; for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('Client secret') >= 0 && items[i].textContent.indexOf('Signing') < 0) { secretLi = items[i]; break; } } if (secretLi) { var btns = secretLi.querySelectorAll('button'); btns[1].click(); 'clicked copy button'; } else { 'not found'; }"
CLIENT_SECRET=$(pbpaste)

# Copy Webhook Signing Secret
agent-browser eval "var items = document.querySelectorAll('li'); var secretLi; for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('Signing secret') >= 0) { secretLi = items[i]; break; } } if (secretLi) { var btns = secretLi.querySelectorAll('button'); btns[1].click(); 'clicked copy button'; } else { 'not found'; }"
WEBHOOK_SECRET=$(pbpaste)
```

Write credentials to env file:
```bash
printf 'LINEAR_CLIENT_ID=%s\n' "$CLIENT_ID" >> ~/.cyrus/.env
printf 'LINEAR_CLIENT_SECRET=%s\n' "$CLIENT_SECRET" >> ~/.cyrus/.env
printf 'LINEAR_WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET" >> ~/.cyrus/.env
```

### Path B: Manual Guided Setup

If `agent-browser` is not available, guide the user through manual creation:

> ### Create a Linear OAuth Application
>
> 1. Go to your **Linear workspace settings**:
>    - Click your workspace name (top-left) → **Settings**
>    - Navigate to **API** in the left sidebar
>    - Scroll to **OAuth Applications** → Click **Create new**
>
> 2. Fill in the form:
>    - **Application name:** `<AGENT_NAME>`
>    - **Developer name:** Your name or org
>    - **Developer URL:** `https://github.com/ceedaragents/cyrus`
>    - **Redirect callback URLs:** `<CYRUS_BASE_URL>/callback`
>    - **Webhook URL:** `<CYRUS_BASE_URL>/webhook`
>    - **Webhook:** ✓ enabled
>    - **Event types:** ✓ Agent session events, ✓ Inbox notifications, ✓ Permission changes, ✓ Issues
>    - **Public:** ✓ enabled
>
> 3. Click **Create**

Then guide the user to save each credential using clipboard-to-env commands:

> Copy the **Client ID** from the app settings page, then run:

**macOS:**
```bash
printf 'LINEAR_CLIENT_ID=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your Linear Client ID: " val && printf 'LINEAR_CLIENT_ID=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

> Now copy the **Client Secret** and run:

**macOS:**
```bash
printf 'LINEAR_CLIENT_SECRET=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your Linear Client Secret: " val && printf 'LINEAR_CLIENT_SECRET=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

> Now copy the **Webhook Signing Secret** and run:

**macOS:**
```bash
printf 'LINEAR_WEBHOOK_SECRET=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your Linear Webhook Signing Secret: " val && printf 'LINEAR_WEBHOOK_SECRET=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

## Step 4: Verify Credentials Written

```bash
grep -c '^LINEAR_CLIENT_ID=' ~/.cyrus/.env
grep -c '^LINEAR_CLIENT_SECRET=' ~/.cyrus/.env
grep -c '^LINEAR_WEBHOOK_SECRET=' ~/.cyrus/.env
```

All three must return 1. If any are missing, ask the user to retry.

## Step 5: Authorize with Linear

Run the OAuth authorization flow:

```bash
cyrus self-auth
```

This will:
1. Start a temporary OAuth callback server
2. Open the browser to Linear's authorization page
3. After the user clicks **Authorize**, save tokens to `~/.cyrus/config.json`

Verify authorization succeeded:

```bash
cat ~/.cyrus/config.json | grep -c '"workspaces"'
```

If the count is 0, authorization failed. Ask the user to check their credentials and try again.

## Completion

> ✓ Linear OAuth application created
> ✓ Credentials saved to `~/.cyrus/.env`
> ✓ Workspace authorized via `cyrus self-auth`
