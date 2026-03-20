---
name: setup-github
description: Configure GitHub authentication for Cyrus — gh CLI login and git config for creating pull requests.
---

# Setup GitHub

Configures GitHub CLI and git so Cyrus can create branches, commits, and pull requests.

## Step 1: Check Existing Configuration

Check if `gh` is already authenticated:

```bash
gh auth status 2>&1
```

If authenticated, check git config:

```bash
git config --global user.name
git config --global user.email
```

If both `gh` auth and git config are set, inform the user:

> GitHub is already configured. Skipping this step.

Skip to completion.

## Step 2: Authenticate GitHub CLI

If `gh` is not authenticated:

```bash
gh auth login
```

This opens an interactive browser flow. Let the user complete it.

After completion, verify:

```bash
gh auth status
```

## Step 3: Configure Git Identity

If git user name or email are not set, ask the user for their preferred values:

> **What name should appear on commits made by Cyrus?**
> (e.g., your name, or "Cyrus Bot")

> **What email should appear on commits?**
> (e.g., your email, or a noreply address)

Then set them:

```bash
git config --global user.name "<name>"
git config --global user.email "<email>"
```

## Step 4: Verify

```bash
gh auth status
git config --global user.name
git config --global user.email
```

## Completion

> ✓ GitHub CLI authenticated
> ✓ Git identity configured: `<name>` <`email`>
