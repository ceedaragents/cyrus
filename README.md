# Cyrus

<div>
  <a href="https://github.com/ceedaragents/cyrus/actions">
    <img src="https://github.com/ceedaragents/cyrus/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>

</div>

[![Discord](https://img.shields.io/discord/1443747721910685792?label=Discord&logo=discord&logoColor=white)](https://discord.gg/prrtADHYTt)

Your (Claude Code|Codex|Cursor|Gemini) powered (Linear|Github|Slack) agent. Cyrus monitors (Linear|Github) issues assigned to it, creates isolated Git worktrees for each issue/repository association, runs (Claude Code|Codex|Cursor|Gemini) sessions to process them, and streams detailed agent activity updates back to (Linear|Github), along with rich interactions like dropdown selects and approvals.

**Note:** Cyrus requires you to bring your own keys/billing for tokens.

## Repository Routing Model

Cyrus uses an explicit `0/1/N` repository-association model for every session instead of assuming one ambient default repository:

- **0 associations**: if routing cannot identify a unique repository, Cyrus keeps the session unassociated and asks the user to choose from the configured repositories.
- **1 association**: if a description tag, routing label, project rule, team rule, or explicit user choice resolves to one repository, Cyrus starts work in that repository.
- **N associations**: when multiple repositories are relevant, Cyrus surfaces all applicable repositories in orchestration/routing context and expects repository-specific work to stay explicitly scoped.

This means ambiguous routing never silently falls back to a default repository, and multi-repository work stays traceable through explicit repository selection and routing signals.

---

## Getting Started

### Pro & Team Plans

Configure Cyrus through the dashboard at [app.atcyrus.com](https://app.atcyrus.com).

#### For self-hosted deployments

```bash
# Install Cyrus
npm install -g cyrus-ai

# Authenticate with your token (provided during onboarding)
cyrus auth <your-token>
```

For Cyrus to create pull requests, configure Git and GitHub CLI. See **[Git & GitHub Setup](./docs/GIT_GITHUB.md)**.

Keep Cyrus running as a persistent process:

- **tmux**: `tmux new -s cyrus` then run `cyrus` (Ctrl+B, D to detach)
- **pm2**: `pm2 start cyrus --name cyrus`
- **systemd**: See [Running as a Service](./docs/SELF_HOSTING.md#running-as-a-service)

#### For cloud-hosted deployments

No installation required. Everything is managed through [app.atcyrus.com](https://app.atcyrus.com).

---

### End-to-End Self-Hosted (Community)

Zero cost option. This requires hosting everything yourself, including your own Linear OAuth app.

Follow the complete **[End-to-End Community Guide](./docs/SELF_HOSTING.md)**.

---

## Documentation

- **[End-to-End Community Guide](./docs/SELF_HOSTING.md)** - Complete community manual setup
- **[Git & GitHub Setup](./docs/GIT_GITHUB.md)** - Git and GitHub CLI configuration for PRs
- **[Configuration Reference](./docs/CONFIG_FILE.md)** - Detailed config.json options
- **[Cloudflare Tunnel Setup](./docs/CLOUDFLARE_TUNNEL.md)** - Expose your local instance
- **[Setup Scripts](./docs/SETUP_SCRIPTS.md)** - Repository and global initialization scripts

---

## License

This project is licensed under the Apache 2.0 license - see the [LICENSE](LICENSE) file for details.

## Credits

This project builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:

- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://www.claude.com/product/claude-code)
