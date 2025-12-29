# Cyrus

<div>
  <a href="https://github.com/ceedaragents/cyrus/actions">
    <img src="https://github.com/ceedaragents/cyrus/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>

</div>

[![Discord](https://img.shields.io/discord/1443747721910685792?label=Discord&logo=discord&logoColor=white)](https://discord.gg/prrtADHYTt)

Your Claude Code powered Linear agent. Cyrus monitors Linear issues assigned to it, creates isolated Git worktrees for each issue, runs Claude Code sessions to process them, and posts responses back to Linear as comments.

**Note:** Cyrus requires you to bring your own Claude Code keys/billing.

---

## Getting Started

| Plan | Hosting | Description |
|------|---------|-------------|
| **Pro** | Self-hosted | Run Cyrus on your own machine or server |
| **Pro** | Cloud-hosted | We run Cyrus for you in our cloud |
| **Team** | Self-hosted | Run Cyrus on your infrastructure with team features |
| **Team** | Cloud-hosted | Fully managed with team collaboration |
| **Free** | End-to-End Self-hosted | Host everything yourself, including Linear OAuth app |

### Pro & Team Plans

Configure Cyrus through the dashboard at [app.atcyrus.com](https://app.atcyrus.com).

**For self-hosted deployments:**

```bash
# Install Cyrus
npm install -g cyrus-ai

# Authenticate with your token (provided during onboarding)
cyrus auth <your-token>
```

Keep Cyrus running as a persistent process:

- **tmux**: `tmux new -s cyrus` then run `cyrus` (Ctrl+B, D to detach)
- **pm2**: `pm2 start cyrus --name cyrus`
- **systemd**: See [Running as a Service](./docs/SELF_HOSTING.md#running-as-a-service)

**For cloud-hosted deployments:**

No installation required. Everything is managed through [app.atcyrus.com](https://app.atcyrus.com).

---

### End-to-End Self-Hosted (Free)

For those who want a completely free, zero-cost option with full control. This requires hosting everything yourself, including your own Linear OAuth app.

Follow the complete **[End-to-End Self-Hosting Guide](./docs/SELF_HOSTING.md)**.

---

## Optional: GitHub Integration

For Cyrus to create pull requests on GitHub, install and authenticate the GitHub CLI:

```bash
# Install (macOS)
brew install gh

# Or find your platform: https://cli.github.com/

# Authenticate
gh auth login
```

---

## Documentation

- **[End-to-End Self-Hosting Guide](./docs/SELF_HOSTING.md)** - Complete free self-hosted setup
- **[Configuration Reference](./docs/CONFIG_FILE.md)** - Detailed config.json options
- **[Cloudflare Tunnel Setup](./docs/CLOUDFLARE_TUNNEL.md)** - Expose your local instance
- **[Setup Scripts](./docs/SETUP_SCRIPTS.md)** - Repository and global initialization scripts

---

## Configuration

After setup, Cyrus stores configuration in `~/.cyrus/config.json`. Key options include:

- **Tool permissions** (`allowedTools`)
- **MCP server configuration** (`mcpConfigPath`)
- **Issue routing** (`teamKeys`, `projectKeys`, `routingLabels`)
- **AI modes** (`labelPrompts`)
- **Global defaults** (`promptDefaults`)

See the **[Configuration Reference](./docs/CONFIG_FILE.md)** for details.

---

## How It Works

When Claude creates PRs using the `gh` CLI tool, it uses your local GitHub authentication. This means:

- All PRs and commits are created under your GitHub account
- Your repository permissions apply to all operations
- The only indication that Claude assisted is the "Co-Authored-By" commit trailer

---

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Credits

Developed by [Ceedar](https://ceedar.ai/)

This project builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:

- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://code.claude.com/docs/en/overview)
