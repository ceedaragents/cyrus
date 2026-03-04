# Setup Scripts

Cyrus supports optional setup scripts that run automatically when creating new git worktrees for issues. This allows you to perform repository-specific or global initialization tasks.

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
