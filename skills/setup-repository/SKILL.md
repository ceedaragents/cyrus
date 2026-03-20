---
name: setup-repository
description: Add one or more Git repositories to Cyrus configuration so it can process issues from those repos.
---

# Setup Repository

Adds Git repositories to Cyrus so it knows which codebases to work with.

## Step 1: Check Existing Repositories

```bash
cat ~/.cyrus/config.json 2>/dev/null | grep -o '"url"' | wc -l
```

If repositories are already configured, list them:

```bash
cat ~/.cyrus/config.json 2>/dev/null
```

Inform the user which repos are already added.

## Step 2: Add a Repository

Ask the user:

> **What is the Git URL of the repository you want Cyrus to work with?**
> (e.g., `https://github.com/yourorg/yourrepo.git`)

Run:

```bash
cyrus self-add-repo <url>
```

This clones the repo to `~/.cyrus/repos/` and registers it with the Linear workspace.

If multiple workspaces are configured, ask which workspace to use:

```bash
cyrus self-add-repo <url> "<workspace name>"
```

Verify the repo was added:

```bash
cat ~/.cyrus/config.json | grep "<repo-name>"
```

## Step 3: Add More?

Ask the user:

> **Would you like to add another repository?** (y/n)

If yes, repeat Step 2. If no, continue.

## Completion

> ✓ Repository added: `<url>`
> (repeat for each added repo)
