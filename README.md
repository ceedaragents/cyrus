# Cyrus

<div>
  <a href="https://ceedar.ai">
    <img src="https://img.shields.io/badge/Built%20by-Ceedar.ai-b8ec83?style=for-the-badge&logoColor=black&labelColor=333333" alt="Built by Ceedar.ai">
  </a><br />
  <a href="https://github.com/ceedaragents/cyrus/actions">
    <img src="https://github.com/ceedaragents/cyrus/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</div>


AI development agent for Linear powered by Claude Code. Cyrus monitors Linear issues assigned to it, creates isolated Git worktrees for each issue, runs Claude Code sessions to process them, and posts responses back to Linear as comments, all from the safety and security of your own computer.

**Please Note: Cyrus is built entirely on the premise that you bring your own Claude Code keys/billing. Your subscription to Cyrus pays for the convenience of a hosted bridge to integrate Claude Code to Linear in a way that's quick and easy to set up and use day-to-day, and funds our small team to ship new features. You can also host the proxy yourself if you don't wish to pay for that convenience. Documentation coming soon.**

## Installation

### Via npm (recommended)

```bash
npm install -g cyrus-ai
```

## Quick Start

#### Optional

(optional, if you want Cyrus to push PRs to Github): Have [`gh`](https://cli.github.com/) (Github) installed. `brew install gh` or find your platform instructions at [this link](https://cli.github.com/). Authenticate using `gh auth login` as the user you want PRs to be submitted via.

####  Run the main program:
```bash
cyrus
```

####  Follow the prompts to:
 - Connect your Linear workspace via OAuth
 - Configure your repository settings
 - Set up allowed tools (security configuration), and optionally, mcp servers

####  Benefit
Keep `cyrus` running, and the agent will start monitoring issues assigned to you in Linear and process them automatically, on your very own device.

## Repository Setup Script

Cyrus supports an optional `cyrus-setup.sh` script that runs automatically when creating new git worktrees for issues. This is useful for repository-specific initialization tasks.

### How it works

1. Place a `cyrus-setup.sh` script in your repository root
2. When Cyrus processes an issue, it creates a new git worktree
3. If the setup script exists, Cyrus runs it in the new worktree with these environment variables:
   - `LINEAR_ISSUE_ID` - The Linear issue ID
   - `LINEAR_ISSUE_IDENTIFIER` - The issue identifier (e.g., "CEA-123")
   - `LINEAR_ISSUE_TITLE` - The issue title

### Example Usage

```bash
#!/bin/bash
# cyrus-setup.sh - Repository initialization script

# Copy environment files from a central location
cp /Users/agentops/code/ceedar/packages/evals/.env packages/evals/.env

# Install dependencies if needed
# npm install

# Set up test databases, copy config files, etc.
echo "Repository setup complete for issue: $LINEAR_ISSUE_IDENTIFIER"
```

Make sure the script is executable: `chmod +x cyrus-setup.sh`

## Submitting Work To GitHub

When Claude creates PRs using the `gh` CLI tool, it uses your local GitHub authentication. This means:

- All PRs and commits will be created under your GitHub account
- Comments and mentions in the PR will notify your account
- Review requests will be attributed to you
- Your repository permissions apply to all operations
- The only indication that Claude assisted is the "Co-Authored-By" commit trailer

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

Developed by [Ceedar](https://ceedar.ai/)

This projects builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:
- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)

---

*This README was last updated: June 11 2025*
