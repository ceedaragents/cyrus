---
name: setup-claude-auth
description: Configure Claude Code authentication for Cyrus — API key, OAuth token, or third-party provider.
---

**CRITICAL: Never use `Read`, `Edit`, or `Write` tools on `~/.cyrus/.env` or any file inside `~/.cyrus/`. Use only `Bash` commands (`grep`, `printf >>`, etc.) to interact with env files — secrets must never be read into the conversation context.**

# Setup Claude Auth

Configures Claude Code credentials so Cyrus can run AI sessions.

## Step 1: Check Existing Auth

Check if credentials are already configured:

```bash
grep -c -E '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=' ~/.cyrus/.env 2>/dev/null || echo "0"
```

If the count is >= 1, inform the user:

> Claude Code authentication is already configured. Skipping this step.
> To reconfigure, remove the existing key from `~/.cyrus/.env` and re-run this skill.

Skip to completion.

## Step 2: Choose Auth Method

Ask the user:

> **How would you like to authenticate Claude Code?**
>
> 1. **Current account** (easiest) — use the credentials from your active `claude` CLI session
> 2. **API Key** — from [console.anthropic.com](https://console.anthropic.com/)
> 3. **Separate OAuth token** — run `claude setup-token` to generate a token for a specific account
> 4. **Third-Party Provider** — Vertex AI, AWS Bedrock, Azure, etc.

## Step 3: Configure Credentials

**CRITICAL: Secrets must NEVER appear in the conversation.** Do not explore `~/.claude/` looking for credential files. Use only the methods below.

Detect the OS for the right clipboard command:

```bash
uname -s
```

### Option 1: Current Account

Check if `claude` is authenticated on this machine:

```bash
claude auth status
```

If authenticated, extract the token directly into the env file without ever showing it in the conversation:

```bash
claude setup-token 2>/dev/null | tail -1 | xargs -I{} printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "{}" >> ~/.cyrus/.env
```

If that command doesn't work (older CLI version), fall back to having the user run it manually:

> Run this command — it generates a token and writes it directly to your env file without showing it:
> ```bash
> claude setup-token
> ```
> Then copy the token and run:

**macOS:**
```bash
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your OAuth token: " val && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

### Option 2: API Key

Instruct the user to copy their API key from the [Anthropic Console](https://console.anthropic.com/), then provide the appropriate command:

**macOS:**
```bash
printf 'ANTHROPIC_API_KEY=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Linux:**
```bash
printf 'ANTHROPIC_API_KEY=%s\n' "$(xclip -selection clipboard -o)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your Anthropic API key: " val && printf 'ANTHROPIC_API_KEY=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

### Option 3: Separate OAuth Token

This is for when the user wants to generate a token for a different account than the one currently logged in (e.g., running `claude setup-token` on another machine).

> On the machine with the account you want to use, run:
> ```bash
> claude setup-token
> ```
> Copy the token, then come back here and run:

**macOS:**
```bash
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$(pbpaste)" >> ~/.cyrus/.env
```

**Linux:**
```bash
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$(xclip -selection clipboard -o)" >> ~/.cyrus/.env
```

**Universal fallback:**
```bash
read -s -p "Paste your OAuth token: " val && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$val" >> ~/.cyrus/.env && echo " ✓ Saved"
```

### Option 4: Third-Party Provider

Inform the user:

> For third-party providers, you'll need to set provider-specific environment variables.
> See [Third-Party Integrations](https://docs.anthropic.com/en/docs/claude-code/bedrock-vertex) for details.
>
> Common configurations:
>
> **AWS Bedrock:**
> ```
> CLAUDE_CODE_USE_BEDROCK=1
> AWS_REGION=us-east-1
> ```
>
> **Google Vertex AI:**
> ```
> CLAUDE_CODE_USE_VERTEX=1
> CLOUD_ML_REGION=us-east5
> ANTHROPIC_VERTEX_PROJECT_ID=your-project-id
> ```

Guide the user to add the appropriate variables to `~/.cyrus/.env` using the clipboard-to-env pattern.

## Step 4: Verify

After the user runs the command, verify the key was written:

```bash
grep -c -E '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX)=' ~/.cyrus/.env
```

If the count is 0, the credential was not saved. Ask the user to try again.

## Completion

> ✓ Claude Code authentication configured.
