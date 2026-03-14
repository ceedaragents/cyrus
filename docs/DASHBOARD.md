# Cyrus Dashboard

The Cyrus Dashboard is a local web interface for monitoring active sessions and managing all Cyrus configuration without hand-editing `~/.cyrus/config.json` or `~/.cyrus/.env`.

---

## How It Works

```
Browser (React SPA)
    ↓ /api/config, /api/env, /api/repositories
Dashboard backend  (Express — apps/dashboard/server.ts, port 3457)
    → reads/writes ~/.cyrus/config.json and ~/.cyrus/.env directly on disk
    ↓ /api/sessions, /api/sessions/stream
Cyrus process  (one SSE endpoint for in-memory session state)
```

The dashboard backend writes config files directly. Cyrus watches those files with `chokidar` and hot-reloads them, so changes take effect immediately without restarting Cyrus.

Session monitoring is the only thing that talks to the running Cyrus process — session state is in-memory and cannot be reconstructed from disk.

---

## Starting the Dashboard

### Development mode (recommended while working on the dashboard)

```bash
cd apps/dashboard
pnpm dev
```

This starts both the Express backend (port 3457) and the Vite dev server (port 5173) with hot module replacement. Open `http://localhost:5173`.

### Production mode

```bash
cd apps/dashboard
pnpm build          # Build the React SPA into dist/
pnpm server         # Serve built frontend + API on port 3457
```

Open `http://localhost:3457`.

---

## Walkthrough

### Step 1 — Connect

The first time you open the dashboard (or after disconnecting), you see the **Connect** screen.

```
┌─────────────────────────────────────────┐
│  Connect to Cyrus                       │
│                                         │
│  Cyrus URL   http://localhost:3456      │
│  API Key     ••••••••••••••••           │
│                                         │
│              [ Connect ]                │
└─────────────────────────────────────────┘
```

- **Cyrus URL** — The address where Cyrus is running. Defaults to `http://localhost:3456`. Change this if Cyrus is on a different port or a remote host.
- **API Key** — The value of `CYRUS_API_KEY` in `~/.cyrus/.env`. This is only used for the live session stream; config reads/writes go through the local dashboard backend and don't require authentication.

Clicking **Connect** sends a `GET <cyrusUrl>/status` request. If it succeeds, the connection settings are saved to `~/.cyrus/dashboard.json` and you land on the Sessions page.

> **Tip:** If Cyrus isn't running yet, you can still use the Config and Repositories pages — they don't need a live Cyrus process. The Sessions page will show a "Connecting…" indicator until Cyrus is reachable.

---

### Step 2 — Sessions

The Sessions page shows all active and recent Cyrus sessions in real time.

```
┌──────────────────────────────────────────────────────────────────┐
│  Sessions                                        ● Live          │
│  3 total                                  [ All statuses ▾ ]     │
│──────────────────────────────────────────────────────────────────│
│  ▶  CYR-42   ● active   claude   claude-opus-4-5   $0.0234       │
│     coding-activity › step 2                                     │
│──────────────────────────────────────────────────────────────────│
│  ▶  CYR-41   ✓ complete  claude                    $0.1820       │
│──────────────────────────────────────────────────────────────────│
│  ▶  CYR-40   ✗ error     gemini                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Status badges:**
| Badge | Meaning |
|---|---|
| `active` (green) | Claude is currently running |
| `awaiting-input` (yellow) | Waiting for a Linear comment |
| `complete` (gray) | Session finished successfully |
| `error` (red) | Session ended with an error |

**Live indicator** (top right):
- `● Live` — SSE stream connected, updates arrive instantly
- `● Polling` — SSE unavailable, refreshing every 5 seconds
- `● Connecting…` — establishing connection

**Expand a session** to see its subroutine history:

```
▼  CYR-42   ● active   claude   claude-opus-4-5   $0.0234
   coding-activity › step 2
   ─────────────────────────────────────────────────────
   Subroutine history
   ✓  scoper          12:01:34
   ✓  coding-activity (in progress)

   Started 2025-01-15 12:00:18
   /Users/you/repos/my-app/worktrees/CYR-42
```

**Filter by status** using the dropdown — useful when you have many sessions and want to focus on active or errored ones.

---

### Step 3 — Global Config

The Global Config page edits `~/.cyrus/config.json` directly. Changes are written when you click **Save**.

#### Default Runner

```
[ claude ]  [ gemini ]  [ codex ]  [ cursor ]
Fallback when no runner label is set on the issue.
```

Cyrus selects a runner primarily by Linear issue labels (e.g. a label named `gemini` routes to the Gemini runner). `defaultRunner` is only used when no matching label is found.

#### Models

| Field | What it controls |
|---|---|
| Claude model | `claudeDefaultModel` — e.g. `claude-opus-4-5` |
| Claude fallback | `claudeDefaultFallbackModel` — used if primary model fails |
| Gemini model | `geminiDefaultModel` |
| Codex model | `codexDefaultModel` |

Leave a field blank to use Cyrus's built-in default for that runner.

#### Default Tools

Tag inputs for `defaultAllowedTools` and `defaultDisallowedTools`. Each entry is a Claude tool permission string. Press **Enter** or **,** after each one.

Examples:
- `Read(**)`
- `Bash(git:*)`
- `mcp__github__create_pull_request`

See [CONFIG_FILE.md](./CONFIG_FILE.md) for the full tool permission syntax.

#### Misc

| Field | What it controls |
|---|---|
| Trigger on issue updates | `issueUpdateTrigger` — whether editing an issue title/description triggers Cyrus |
| Global setup script | `global_setup_script` — shell script run in every new worktree |
| Ngrok auth token | `ngrokAuthToken` — for ngrok tunnel (alternative to Cloudflare) |
| Linear workspace slug | `linearWorkspaceSlug` — e.g. `mycompany` |

#### Environment Variables

The bottom section edits `~/.cyrus/.env` directly. Known secret keys (`ANTHROPIC_API_KEY`, `LINEAR_CLIENT_SECRET`, etc.) are displayed as password fields — leave them blank to keep the existing value.

| Key | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Claude runner |
| `CLAUDE_CODE_OAUTH_TOKEN` | Alternative to API key for Claude |
| `GEMINI_API_KEY` | Enables the Gemini runner |
| `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | Linear OAuth app credentials |
| `LINEAR_WEBHOOK_SECRET` | Webhook signature verification |
| `CYRUS_BASE_URL` | Public URL Cyrus uses for Linear webhooks |
| `CYRUS_SERVER_PORT` | Port Cyrus listens on (default: `3456`) |
| `CLOUDFLARE_TOKEN` | Cloudflare tunnel token (optional) |
| `CYRUS_API_KEY` | API key for dashboard auth and SSE stream |

> Cyrus hot-reloads `~/.cyrus/config.json` via `chokidar`. Environment variable changes (`~/.cyrus/.env`) take effect on the next Cyrus restart.

---

### Step 4 — Repositories

The Repositories page lists all configured repositories and lets you add, edit, or delete them.

```
┌─────────────────────────────────────────────────────── [ + Add Repository ] ─┐
│  my-app          /Users/you/repos/my-app     main   MyWorkspace               │
│  another-repo    /Users/you/repos/other      dev    MyWorkspace               │
└──────────────────────────────────────────────────────────────────────────────┘
```

Click the **pencil icon** to open the slide-over editor.

#### Slide-over form sections

**Identity**
- `Name` — human-readable label (shown in the list)
- `ID` — auto-generated UUID; used as the stable identifier in config

**Git**
- `Repository path` — absolute path to the local git repo (e.g. `/Users/you/repos/my-app`)
- `Base branch` — default branch to branch from (e.g. `main`)
- `Workspace base dir` — where worktrees are created (e.g. `/Users/you/repos/my-app/worktrees`)
- `GitHub URL` — used for creating pull requests

**Linear**
- `Workspace ID` / `Workspace name` — your Linear workspace identifiers
- `Token` / `Refresh token` — Linear OAuth tokens for this repository
- `Team keys` — Linear team identifiers that route to this repo (e.g. `ENG`, `BACKEND`)
- `Routing labels` — Linear labels that route to this repo
- `Project keys` — Linear project identifiers that route to this repo

**Runner & Tools**
- `Model override` — overrides `claudeDefaultModel` for this repo only
- `Fallback model` — overrides `claudeDefaultFallbackModel` for this repo only
- `Allowed tools` / `Disallowed tools` — repo-specific tool permissions (merged with global defaults)

**Label Branch Config**

Maps Linear issue labels to a specific base branch and/or branch name prefix.

```
label       →  base branch    prefix
─────────────────────────────────────────────
hotfix      →  master         hotfix/
feature     →  develop        feature/
release     →  main           release/
[ + Add rule ]
```

When Cyrus creates a branch for an issue, it checks the issue's labels against this table (first match wins):
- `base` — overrides the repository's default base branch for this label
- `prefix` — prepended to the branch name (e.g. `hotfix/fix-login-bug`)

Leave `base` blank to use the repository's default. Leave `prefix` blank to use no prefix.

**Advanced**
- `MCP config path` — path(s) to MCP server config files (can be a single path or comma-separated list)
- `Prompt template path` — custom prompt template for this repo
- `Append instruction` — text appended to every session prompt for this repo
- `Active` checkbox — uncheck to disable the repo without deleting it

---

### Step 5 — Access Control

The Access Control page controls which Linear users can trigger Cyrus sessions.

#### Global access control

Applies to all repositories unless overridden per-repository.

```
Allowed users          Blocked users
──────────────────     ─────────────────────
user@company.com  ×    badactor@example.com ×
usr_abc123        ×    [ add… ]
[ add… ]

Block behavior
○ Silent — ignore the issue silently
● Message — reply with block message

Block message
[ You don't have permission to use Cyrus. ]
```

- **Allowed users** — if non-empty, only these users can trigger sessions. Leave empty to allow everyone (minus the blocked list).
- **Blocked users** — always denied, regardless of the allowed list.
- **Block behavior** — `silent` ignores blocked requests; `message` posts a reply to the Linear issue.

User identifiers can be Linear user IDs (`usr_abc123`) or email addresses.

#### Per-repository access control

The lower section shows a summary of all repositories. Repos with an access control override show `Override`; others show `Inherited` (they use the global settings). To set repo-specific access control, edit the repository from the Repositories page (scroll to the access control section in the slide-over).

---

## Configuration Files

The dashboard reads and writes two files:

| File | What it stores |
|---|---|
| `~/.cyrus/config.json` | All Cyrus config (repositories, global settings, access control) |
| `~/.cyrus/.env` | Environment variables (API keys, tokens, URLs) |
| `~/.cyrus/dashboard.json` | Dashboard connection settings (Cyrus URL + API key) |

You can still edit `~/.cyrus/config.json` by hand — Cyrus hot-reloads it. The dashboard reads the file fresh on every request, so manual edits are immediately visible on the next page load.

---

## Troubleshooting

**Sessions page shows "Connecting…" indefinitely**
- Make sure Cyrus is running (`cyrus` in a terminal)
- Verify the Cyrus URL on the Connect screen matches the actual Cyrus port (default `3456`)
- Check that `CYRUS_API_KEY` in `~/.cyrus/.env` matches the key you entered on the Connect screen

**Config changes don't seem to take effect**
- Check the browser console for save errors (the backend logs to stdout)
- Verify `~/.cyrus/config.json` is writable: `ls -la ~/.cyrus/config.json`

**"Could not reach Cyrus" on the Connect screen**
- The connectivity check hits `<cyrusUrl>/status`. Confirm Cyrus is listening on that address before connecting.
- If Cyrus is behind a tunnel (Cloudflare, ngrok), use the tunnel URL, not `localhost`.

**Dashboard backend won't start**
- Make sure you're in the `apps/dashboard` directory and have run `pnpm install` from the repo root.
- Port 3457 may already be in use: `lsof -i :3457`
