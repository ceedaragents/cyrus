---
name: deploy-preview
description: Validate endpoint changes in a preview environment with required GitHub and Linear app setup notes.
---

# Deploy Preview

Use this skill when you need a fast browser-first validation pass for webhook-related changes.

## Setup Checklist

1. Configure GitHub App credentials in the preview environment so webhooks can be verified.
   - `GITHUB_APP_ID`
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `GITHUB_WEBHOOK_SECRET`
   - Configure the GitHub App webhook URL as `${PREVIEW_URL}/github-webhook`.
   - Subscribe at minimum to `issues`, `issue_comment`, and `pull_request` events.

2. Configure Linear App credentials in the preview environment so webhook endpoints authenticate.
   - `LINEAR_APP_ID`
   - `LINEAR_CLIENT_ID`
   - `LINEAR_CLIENT_SECRET`
   - `LINEAR_WEBHOOK_SECRET`
   - Configure the Linear App webhook URL as `${PREVIEW_URL}/webhook`.

3. Deploy the branch as a preview environment and note the preview URL.
   - Example: `export PREVIEW_URL=https://...`

## Hands-On Validation

- Use `/deploy-preview` to run a browser-first validation pass against the preview environment.
- Start `agent-browser --help` to confirm CLI availability.
- In sandboxed/macOS environments, force a writable socket directory before checks to avoid socket/path permission issues:
  - `export AGENT_BROWSER_SOCKET_DIR="$(mktemp -d /tmp/agent-browser-socket.XXXXXX)"`
- If local `agent-browser` fails with a browser launch error (for example Mach permission or launch aborts), rerun with one of the supported remote providers that avoids local Chromium:
  - Kernel: `export AGENT_BROWSER_PROVIDER=kernel` and `export KERNEL_API_KEY=...`
  - Browserbase: `export AGENT_BROWSER_PROVIDER=browserbase`, `export BROWSERBASE_API_KEY=...`, `export BROWSERBASE_PROJECT_ID=...`
  - Browser Use: `export AGENT_BROWSER_PROVIDER=browseruse` and `export BROWSER_USE_API_KEY=...`
- After setting provider/credentials and socket override, run:
  - `agent-browser open "$PREVIEW_URL" --json`
  - Example:
    - `AGENT_BROWSER_SOCKET_DIR="$AGENT_BROWSER_SOCKET_DIR" agent-browser open "$PREVIEW_URL" --json`
  - Expectation: auth/key error until valid provider credentials are provisioned.
- If required provider credentials are not available in the current environment, stop and rerun once they are, as browser-driven deploy-preview validation cannot complete in this environment without them.
- Run a preview check using your preview URL (local provider / remote provider as available):
  - `agent-browser open "$PREVIEW_URL" --json`
- Validate the following in-browser behavior:
  - GitHub webhook test endpoint accepts both native and proxied headers
  - Linear webhook test endpoint accepts both native and proxied headers
  - The app receives and logs webhook events without runtime errors
- If local `agent-browser` cannot start (for example Mach permission or browser launch failures),
  document the failure and rerun this validation in an environment with a working browser provider.
