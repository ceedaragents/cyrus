# Git & GitHub Setup

Cyrus uses your local Git and GitHub CLI (`gh`) authentication to create commits and pull requests. This guide explains how to configure these tools and what permissions Cyrus will have.

---

## Understanding Permissions

**Important:** Cyrus operates with the same permissions as your authenticated GitHub CLI user for repository access.

When Cyrus creates commits and PRs:
- All commits are attributed to the `cyrusagent` GitHub user ([github.com/cyrusagent](https://github.com/cyrusagent))
- All PRs are created under your GitHub account (using `gh` CLI authentication)
- Your repository access permissions apply to all operations

This means Cyrus can access any repository your authenticated user can access. Configure authentication carefully based on what repositories you want Cyrus to work with.

---

## Git Configuration

Cyrus automatically configures git user settings within each worktree it creates. Commits will be attributed to:
- **User:** `cyrusagent`
- **Email:** `208047790+cyrusagent@users.noreply.github.com`

This allows you to mention `@cyrusagent` on GitHub PRs and enables proper attribution of AI-assisted commits.

### SSH Authentication (Recommended)

Set up SSH keys for Git operations:

```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "your.email@example.com"

# Start the SSH agent
eval "$(ssh-agent -s)"

# Add your key to the agent
ssh-add ~/.ssh/id_ed25519

# Copy the public key
cat ~/.ssh/id_ed25519.pub
```

Add the public key to your GitHub account at [github.com/settings/keys](https://github.com/settings/keys).

---

## GitHub CLI Setup

Install and authenticate the GitHub CLI for PR creation:

### Installation

**macOS:**
```bash
brew install gh
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install gh
```

**Other platforms:** See [cli.github.com](https://cli.github.com/)

### Authentication

```bash
gh auth login
```

Follow the prompts to authenticate. For servers without a browser, use a personal access token:

```bash
gh auth login --with-token < token.txt
```

### Verify Setup

```bash
# Check Git config
git config --global user.name
git config --global user.email

# Check GitHub CLI
gh auth status
```

---

## Security Considerations

- **Use a dedicated account** for Cyrus if you want to limit its access
- **Repository access** is determined by your SSH key and GitHub token permissions
- **Review permissions** before adding repositories to Cyrus
- **Audit commits** - all Cyrus commits are attributed to the `cyrusagent` GitHub user for easy identification
