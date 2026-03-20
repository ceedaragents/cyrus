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
grep -E '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=' ~/.cyrus/.env 2>/dev/null
```

If a key is already set, inform the user:

> Claude Code authentication is already configured. Skipping this step.
> To reconfigure, remove the existing key from `~/.cyrus/.env` and re-run this skill.

Skip to completion.

## Step 2: Choose Auth Method

Ask the user:

> **How would you like to authenticate Claude Code?**
>
> 1. **API Key** (recommended) — from [console.anthropic.com](https://console.anthropic.com/)
> 2. **OAuth Token** — for Claude Max/Pro subscription users
> 3. **Third-Party Provider** — Vertex AI, AWS Bedrock, Azure, etc.

## Step 3: Configure Credentials

**CRITICAL: Secrets must NEVER appear in the conversation.** Use clipboard-to-env or hidden-stdin commands.

Detect the OS for the right clipboard command:

```bash
uname -s
```

### Option 1: API Key

Instruct the user to copy their API key from the Anthropic Console, then provide the appropriate command:

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

### Option 2: OAuth Token

Instruct the user:

> On any machine where Claude Code is already installed, run:
> ```bash
> claude setup-token
> ```
> Copy the token, then run:

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

### Option 3: Third-Party Provider

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

Guide the user to add the appropriate variables to `~/.cyrus/.env`.

## Step 4: Verify

After the user runs the command, verify the key was written:

```bash
grep -c -E '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX)=' ~/.cyrus/.env
```

If the count is 0, the credential was not saved. Ask the user to try again.

## Completion

> ✓ Claude Code authentication configured.
