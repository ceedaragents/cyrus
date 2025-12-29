# Cyrus

<div>
  <a href="https://github.com/ceedaragents/cyrus/actions">
    <img src="https://github.com/ceedaragents/cyrus/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>

</div>

[![Discord](https://img.shields.io/discord/1443747721910685792?label=Discord&logo=discord&logoColor=white)](https://discord.gg/prrtADHYTt)

Your Claude Code powered Linear agent. Cyrus monitors Linear issues assigned to it, creates isolated Git worktrees for each issue, runs Claude Code sessions to process them, and posts responses back to Linear as comments.

**Note:** Cyrus requires you to bring your own Claude Code keys/billing. Paid plans provide support, easy configuration UI, and hosted infrastructure.

---

## Getting Started

Choose the option that best fits your needs:

### Option 1: Pro Plan (Run on Your Machine)

For paid Pro users who want Cyrus running on their own machine.

```bash
# Install Cyrus
npm install -g cyrus-ai

# Authenticate with your token (provided during onboarding at app.atcyrus.com)
cyrus auth <your-token>
```

**Running Cyrus:**

Keep Cyrus running as a persistent process using any of these methods:

- **tmux**: `tmux new -s cyrus` then run `cyrus` (Ctrl+B, D to detach)
- **pm2**: `pm2 start cyrus --name cyrus`
- **systemd**: Create a service file (see [Self-Hosting Guide](./docs/SELF_HOSTING.md#using-systemd-linux))
- **macOS**: Configure as a startup service

Press Ctrl+C to stop Cyrus at any time.

---

### Option 2: Team Plan (Fully Hosted)

For paid Team users using the fully hosted strategy.

No local installation required. Your Cyrus agent runs entirely in our cloud infrastructure. Configure everything through the dashboard at [app.atcyrus.com](https://app.atcyrus.com).

---

### Option 3: Self-Hosted (Free)

For those who want a completely free, zero-cost option with full control.

This requires self-hosting everything including your own Linear OAuth app. Follow the complete **[Self-Hosting Guide](./docs/SELF_HOSTING.md)** for step-by-step instructions.

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

- **[Self-Hosting Guide](./docs/SELF_HOSTING.md)** - Complete self-hosted setup instructions
- **[Configuration Reference](./docs/CONFIG_FILE.md)** - Detailed config.json options and examples
- **[Cloudflare Tunnel Setup](./docs/CLOUDFLARE_TUNNEL.md)** - Expose your local instance with a permanent URL
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
