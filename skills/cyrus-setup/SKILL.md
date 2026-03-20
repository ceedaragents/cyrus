---
name: cyrus-setup
description: Set up Cyrus end-to-end — install prerequisites, configure authentication, create integrations (Linear, GitHub, Slack), add repositories, and launch. Run this once to get Cyrus running as a background agent.
---

# Cyrus Setup

One-command setup for self-hosted Cyrus. This orchestrator walks you through everything needed to run Claude Code as a background agent from Linear, Slack, and GitHub.

## CRITICAL Rules

### Never Read or Write ~/.cyrus/.env Directly

**FORBIDDEN:** Do NOT use `Read`, `Edit`, or `Write` tools on `~/.cyrus/.env` or any file inside `~/.cyrus/`. This file contains secrets (API keys, tokens, signing secrets). All interaction with this file MUST go through `Bash` commands (`grep`, `printf >> ...`, etc.) which the user can see and approve. Never read its contents into the conversation context.

### Browser Automation

The goal of browser automation in this skill is to **reduce sign-in and setup fatigue** — the agent navigates web UIs, fills forms, and scrapes credentials so the user doesn't have to do it all manually.

**Three modes, in order of preference:**

1. **`agent-browser` CLI** (default) — a standalone Playwright-based binary invoked via `Bash`. When this skill says "agent-browser", it means this tool. Check with `which agent-browser`.
2. **`claude-in-chrome`** — if the user prefers to use their existing Chrome browser via the MCP extension, respect that preference. But do NOT default to it or try it as an automatic fallback — it's a different tool with different capabilities.
3. **Manual guided flow** — the user follows the agent's step-by-step instructions and does the clicks themselves. Always available as Path B in each sub-skill.

If `agent-browser` is not installed, **ask the user** which they'd prefer: installing `agent-browser`, using `claude-in-chrome` (if available), or following manual instructions. Respect their choice.

## How This Works

This skill runs sub-skills in order, skipping any that are already complete. You can re-run `/setup` at any time to add integrations or fix configuration.

Sub-skills (each independently invocable):
- `/setup-prerequisites` — Install Node.js, jq, gh, cyrus-ai
- `/setup-claude-auth` — Configure Claude Code API key or OAuth token
- `/setup-endpoint` — Set up public webhook URL (ngrok, Cloudflare, or custom)
- `/setup-linear` — Create Linear OAuth app + authorize workspace
- `/setup-github` — Authenticate GitHub CLI + configure git
- `/setup-slack` — Create Slack app + configure bot token
- `/setup-repository` — Add Git repositories to Cyrus
- `/setup-launch` — Summary + start Cyrus

---

## Step 0: Identity & Surface Selection

Before anything else, collect preferences from the user. **Use the `AskUserQuestion` tool if available** — ask questions interactively rather than printing them as a text block. You may bundle related questions into a single ask, or ask them one at a time.

### Question 1: Name & Description

Ask the user (defaults in parentheses):

- **What would you like to name your agent?** — This name appears in Linear, Slack, and GitHub integrations. (default: `Cyrus`)
- **Give your agent a short description** — one sentence, shown in integration app listings. (default: `AI coding agent for automated development`)

Store as `AGENT_NAME` and `AGENT_DESCRIPTION` — used when creating Linear, Slack, and GitHub apps.

### Question 2: Which surfaces?

Ask the user to select one or more:

- **Linear** — issue tracking, recommended for most users
- **GitHub** — PR comments and issues
- **Slack** — chat messages

At least one is required. Store the selection — it determines which integration sub-skills run (Steps 4-6).

### Question 3: Package manager?

Ask: **npm, pnpm, bun, or yarn?**

Store the answer — used by the prerequisites skill.

---

## Step 1: Prerequisites

Run the `setup-prerequisites` sub-skill.

This checks system dependencies (Node.js, jq, gh), installs `cyrus-ai`, and optionally checks for `agent-browser`.

Pass the user's package manager preference.

---

## Step 2: Claude Auth

Run the `setup-claude-auth` sub-skill.

This configures Claude Code credentials (API key, OAuth token, or third-party provider). Skips if already configured.

---

## Step 3: Webhook Endpoint

Run the `setup-endpoint` sub-skill.

This sets up a public URL for webhooks — ngrok (recommended), Cloudflare Tunnel, or a custom URL. Skips if `CYRUS_BASE_URL` is already set.

---

## Step 4: Linear (if selected)

**Only run if the user selected Linear in Step 0.**

Run the `setup-linear` sub-skill.

This creates a Linear OAuth application (via agent-browser or manual guided flow), saves credentials, and runs `cyrus self-auth` to authorize the workspace.

---

## Step 5: GitHub (if selected)

**Only run if the user selected GitHub in Step 0.**

Run the `setup-github` sub-skill.

This authenticates the GitHub CLI and configures git identity for commits and pull requests.

---

## Step 6: Slack (if selected)

**Only run if the user selected Slack in Step 0.**

Run the `setup-slack` sub-skill.

This guides creation of a Slack app with the right permissions and event subscriptions, then saves bot token and signing secret.

---

## Step 7: Add Repositories

Run the `setup-repository` sub-skill.

This asks for Git repository URLs and registers them with Cyrus via `cyrus self-add-repo`. Loops until the user is done adding repos.

---

## Step 8: Launch

Run the `setup-launch` sub-skill.

This prints a summary of everything configured, reminds the user to start ngrok if applicable, and offers to start Cyrus.

---

## Design Principles

1. **Skip-if-done** — Every sub-skill checks existing state first. Re-running `/setup` is safe.
2. **Secrets never enter chat** — Credentials are either scraped via agent-browser or written via clipboard-to-env shell commands the user runs in their terminal.
3. **Agent writes non-secret config** — Values like `CYRUS_SERVER_PORT` and `LINEAR_DIRECT_WEBHOOKS` are written directly by the agent.
4. **Browser automation when available** — Uses `agent-browser` for Linear/Slack app creation; falls back to guided manual steps if not installed.
5. **Package manager aware** — The user's choice is used consistently throughout.
