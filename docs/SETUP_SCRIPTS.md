# Setup & Teardown Scripts

Cyrus supports optional scripts that run automatically during the worktree lifecycle — setup scripts when creating worktrees, and teardown scripts before deleting them.

---

## Repository Setup Script

Place a `cyrus-setup.sh` script in your repository root to run repository-specific initialization.

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
cp /path/to/shared/.env packages/app/.env

# Install dependencies if needed
# npm install

# Set up test databases, copy config files, etc.
echo "Repository setup complete for issue: $LINEAR_ISSUE_IDENTIFIER"
```

Make sure the script is executable: `chmod +x cyrus-setup.sh`

---

## Global Setup Script

In addition to repository-specific scripts, you can configure a global setup script that runs for **all** repositories when creating new worktrees.

### Configuration

Add `global_setup_script` to your `~/.cyrus/config.json`:

```json
{
  "repositories": [...],
  "global_setup_script": "/opt/cyrus/bin/global-setup.sh"
}
```

### Execution Order

When creating a new worktree:

1. **Global script** runs first (if configured)
2. **Repository script** (`cyrus-setup.sh`) runs second (if exists)

Both scripts receive the same environment variables and run in the worktree directory.

### Use Cases

- **Team-wide tooling** that applies to all repositories
- **Shared credential** setup
- **Common environment** configuration

Make sure the script is executable: `chmod +x /opt/cyrus/bin/global-setup.sh`

### Error Handling

- If the global script fails, Cyrus logs the error but continues with repository script execution
- Both scripts have a 5-minute timeout to prevent hanging
- Script failures don't prevent worktree creation

---

## Global Teardown Script

When an issue reaches a terminal state (Done, Canceled, or deleted), Cyrus deletes the worktree. A global teardown script runs **before** the worktree directory is removed, allowing you to clean up resources that were provisioned by the setup script.

### Configuration

Add `global_teardown_script` to your `~/.cyrus/config.json`:

```json
{
  "repositories": [...],
  "global_setup_script": "~/.cyrus/scripts/setup.sh",
  "global_teardown_script": "~/.cyrus/scripts/teardown.sh"
}
```

### Environment Variables

The teardown script receives:

- `LINEAR_ISSUE_IDENTIFIER` - The issue identifier (e.g., "CEA-123")

The script runs in the worktree directory, so it can read files like `.env.local` that were written by the setup script.

### Example Usage

```bash
#!/bin/bash
# teardown.sh - Clean up per-worktree databases

if [ -f "bin/worktree-teardown" ]; then
  bin/worktree-teardown
fi

echo "Teardown complete for issue: $LINEAR_ISSUE_IDENTIFIER"
```

### Use Cases

- **Drop per-worktree databases** provisioned during setup
- **Deregister services** or ports claimed by the worktree
- **Clean up temporary credentials** or tokens

### Error Handling

- The teardown script has a 2-minute timeout
- Script failures are logged but do **not** prevent worktree deletion
- The worktree directory is always removed after the script runs (or fails)
