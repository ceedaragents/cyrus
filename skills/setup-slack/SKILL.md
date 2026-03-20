---
name: setup-slack
description: Configure Slack integration for Cyrus — create a Slack app from manifest via agent-browser or guided manual setup, then capture bot token and signing secret.
---

**CRITICAL: Never use `Read`, `Edit`, or `Write` tools on `~/.cyrus/.env` or any file inside `~/.cyrus/`. Use only `Bash` commands (`grep`, `printf >>`, etc.) to interact with env files — secrets must never be read into the conversation context.**

# Setup Slack

Creates a Slack application from a pre-built manifest so Cyrus can respond to messages in Slack channels. Supports automated creation via agent-browser or guided manual flow.

## Step 1: Check Existing Configuration

```bash
grep -E '^SLACK_BOT_TOKEN=' ~/.cyrus/.env 2>/dev/null
```

If `SLACK_BOT_TOKEN` is already set, inform the user:

> Slack is already configured. Skipping this step.
> To reconfigure, remove `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` from `~/.cyrus/.env` and re-run.

Skip to completion.

## Step 2: Read Variables

Read the base URL (set by `setup-endpoint`):

```bash
grep '^CYRUS_BASE_URL=' ~/.cyrus/.env | cut -d= -f2-
```

You also need `AGENT_NAME` and `AGENT_DESCRIPTION` — these were collected in Step 0 of the orchestrator and should be available from the conversation context.

## Step 3: Build Manifest JSON

Construct the manifest, substituting `<AGENT_NAME>`, `<AGENT_DESCRIPTION>`, and `<CYRUS_BASE_URL>` with actual values:

```json
{
    "display_information": {
        "name": "<AGENT_NAME>",
        "description": "<AGENT_DESCRIPTION>",
        "background_color": "#00240e"
    },
    "features": {
        "bot_user": {
            "display_name": "<AGENT_NAME>",
            "always_online": false
        }
    },
    "oauth_config": {
        "redirect_urls": [
            "<CYRUS_BASE_URL>/slack/oauth/callback"
        ],
        "scopes": {
            "user": [
                "canvases:read",
                "canvases:write",
                "channels:history",
                "chat:write",
                "groups:history",
                "im:history",
                "mpim:history",
                "users:read",
                "users:read.email",
                "reactions:write",
                "search:read.public",
                "search:read.private",
                "search:read.mpim",
                "search:read.im",
                "search:read.files",
                "search:read.users"
            ],
            "bot": [
                "groups:read",
                "app_mentions:read",
                "assistant:write",
                "canvases:write",
                "channels:history",
                "channels:read",
                "chat:write",
                "chat:write.customize",
                "groups:history",
                "im:history",
                "mpim:history",
                "reactions:write",
                "search:read.files",
                "search:read.public",
                "search:read.users",
                "users:read",
                "users:read.email",
                "mpim:read"
            ]
        },
        "pkce_enabled": false
    },
    "settings": {
        "event_subscriptions": {
            "request_url": "<CYRUS_BASE_URL>/slack-webhook",
            "bot_events": [
                "app_mention",
                "member_joined_channel"
            ]
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": false,
        "token_rotation_enabled": false
    }
}
```

## Step 4: Create Slack App

Check if `agent-browser` is available:

```bash
which agent-browser 2>/dev/null
```

### Path A: agent-browser Automation

If `agent-browser` is available, automate the entire flow.

First, connect to the user's running Chrome:

```bash
agent-browser --auto-connect
```

#### 4a. Navigate to Slack app creation

```bash
agent-browser navigate "https://api.slack.com/apps"
```

Take a screenshot to verify the page loaded and the user is logged in. If not logged in, the user will need to log in manually or via `agent-browser auth login slack` if supported.

#### 4b. Click "Create New App"

```bash
agent-browser click "button:text('Create New App')"
```

#### 4c. Select "From a manifest" in the modal

```bash
agent-browser click "button:text('From a manifest')"
```

#### 4d. Select workspace

Take a screenshot to see the workspace picker. Click the appropriate workspace. If multiple are listed, ask the user which one to use.

```bash
agent-browser screenshot
```

Then click the workspace and click **Next**:

```bash
agent-browser click "button:text('Next')"
```

#### 4e. Select JSON format and paste manifest

Click the **JSON** tab if not already selected:

```bash
agent-browser click "button:text('JSON')"
```

Clear the existing content in the manifest editor and paste the built manifest. Use JavaScript to set the editor value:

```bash
agent-browser eval "var editor = document.querySelector('textarea, [role=\"textbox\"], .ace_editor textarea, .CodeMirror textarea'); if (editor) { var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; nativeInputValueSetter.call(editor, JSON.stringify(<MANIFEST_JSON>, null, 2)); editor.dispatchEvent(new Event('input', { bubbles: true })); 'pasted'; } else { 'editor not found'; }"
```

If the textarea approach doesn't work, try selecting all text and typing the manifest:

```bash
agent-browser click "textarea"
agent-browser keyboard "Control+a"
agent-browser type '<MANIFEST_JSON_STRING>'
```

Take a screenshot to verify the manifest was pasted correctly, then click **Next**:

```bash
agent-browser click "button:text('Next')"
```

#### 4f. Review and create

Take a screenshot to verify the summary looks correct, then click **Create**:

```bash
agent-browser click "button:text('Create')"
```

#### 4g. Install to workspace

After creation, Slack shows the app's Basic Information page. Click **Install to Workspace** (may need to navigate to the Install App section first):

```bash
agent-browser click "a:text('Install App')"
```

Then:

```bash
agent-browser click "button:text('Install to Workspace')"
```

If a permissions consent page appears, click **Allow**:

```bash
agent-browser click "button:text('Allow')"
```

#### 4h. Capture Bot Token

Navigate to OAuth & Permissions:

```bash
agent-browser click "a:text('OAuth & Permissions')"
```

Take a screenshot. Use JavaScript to find and click the copy button next to the Bot User OAuth Token, then read from clipboard:

```bash
agent-browser eval "var tokenSection = document.querySelector('[data-qa=\"oauth_token_copy_btn\"]'); if (tokenSection) { tokenSection.click(); 'clicked'; } else { var copyBtns = document.querySelectorAll('button'); for (var i = 0; i < copyBtns.length; i++) { if (copyBtns[i].closest && copyBtns[i].closest('[class*=\"token\"]')) { copyBtns[i].click(); break; } } 'attempted fallback'; }"
```

```bash
BOT_TOKEN=$(pbpaste)
printf 'SLACK_BOT_TOKEN=%s\n' "$BOT_TOKEN" >> ~/.cyrus/.env
```

If the copy button approach fails, take a screenshot and look for the token value (starts with `xoxb-`), then use JavaScript to extract it from the page DOM.

#### 4i. Capture Signing Secret

Navigate to Basic Information:

```bash
agent-browser click "a:text('Basic Information')"
```

Scroll to **App Credentials** and find the Signing Secret. It is hidden by default — click **Show** to reveal it:

```bash
agent-browser click "button:text('Show')"
```

Then copy via JavaScript or the copy button:

```bash
agent-browser eval "var items = document.querySelectorAll('[class*=\"credential\"], [class*=\"secret\"]'); var found = false; for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('Signing Secret') >= 0) { var btn = items[i].querySelector('button[title*=\"Copy\"], button[aria-label*=\"Copy\"]'); if (btn) { btn.click(); found = true; break; } } } found ? 'clicked' : 'not found';"
```

```bash
SIGNING_SECRET=$(pbpaste)
printf 'SLACK_SIGNING_SECRET=%s\n' "$SIGNING_SECRET" >> ~/.cyrus/.env
```

If automated copy fails, take a screenshot of the revealed signing secret and ask the user to copy it manually, then use a clipboard-to-env command.

### Path B: Manual Guided Setup

If `agent-browser` is not available, guide the user through the manifest flow manually:

> ### Create a Slack App
>
> 1. Go to https://api.slack.com/apps
> 2. Click **Create New App**
> 3. In the modal, select **From a manifest**
> 4. Pick the **workspace** you want to associate the app with
> 5. Click **Next**
> 6. Select **JSON** format and paste the following manifest:

Print the fully-substituted manifest JSON for the user to copy.

> 7. Click **Next**, review the summary, then click **Create**
> 8. Go to **Install App** in the left sidebar → click **Install to Workspace** → click **Allow**

Then guide the user to save each credential using clipboard-to-env commands:

> Copy the **Bot User OAuth Token** from **OAuth & Permissions** (starts with `xoxb-`), then run:

**macOS:**
```bash
printf 'SLACK_BOT_TOKEN=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your Slack Bot Token: " val && printf 'SLACK_BOT_TOKEN=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

> Now go to **Basic Information** → **App Credentials** → copy the **Signing Secret**, then run:

**macOS:**
```bash
printf 'SLACK_SIGNING_SECRET=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your Slack Signing Secret: " val && printf 'SLACK_SIGNING_SECRET=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

## Step 5: Verify

```bash
grep -c '^SLACK_BOT_TOKEN=' ~/.cyrus/.env
grep -c '^SLACK_SIGNING_SECRET=' ~/.cyrus/.env
```

Both must return 1.

**Note:** The event subscription `request_url` will fail Slack's verification challenge until Cyrus is actually running. Once Cyrus is started, go to the app's **Event Subscriptions** page and re-enter the URL to trigger verification, or Slack will retry automatically.

## Completion

> ✓ Slack app created from manifest and installed
> ✓ Bot token and signing secret saved to `~/.cyrus/.env`
