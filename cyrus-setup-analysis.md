# Cyrus Setup Script Analysis

## Summary

The `cyrus-setup.sh` script has **limited persistence** - it runs only once during worktree creation, and environment changes do **NOT** persist into Claude agent sessions.

## How It Works

### Execution Flow

1. **Trigger**: Script runs when Cyrus creates a new git worktree for an issue
2. **Location**: Executes in the worktree directory (not main repo)
3. **Timing**: Runs once per worktree creation, before any Claude sessions start
4. **Implementation**: See `apps/cli/src/services/GitService.ts:401-408`

### Technical Details

```typescript
// The script is executed with:
execSync(command, {
  cwd: workspacePath,           // Runs in the worktree
  stdio: "inherit",             // Shows output to console
  env: {
    ...process.env,
    LINEAR_ISSUE_ID: issue.id,
    LINEAR_ISSUE_IDENTIFIER: issue.identifier,
    LINEAR_ISSUE_TITLE: issue.title || "",
  },
  timeout: 5 * 60 * 1000,       // 5 minute timeout
});
```

### What Persists

✅ **These actions persist:**
- File system changes (created files, modified files)
- Git operations (commits, branches)
- Installed dependencies (if npm/pnpm install runs)

❌ **These DO NOT persist:**
- Environment variables
- Shell aliases/functions
- Active shell sessions
- Background processes

## Why `exec nix develop` Won't Work

### Problem 1: Process Replacement

```bash
#!/bin/bash
exec nix develop  # This REPLACES the bash process
```

When `exec` runs:
1. The bash process running the script is **replaced** with nix-shell
2. The script never "completes" from Cyrus's perspective
3. Cyrus will wait for the script to finish until timeout (5 minutes)
4. The nix-shell environment doesn't connect to Claude's sessions

### Problem 2: Environment Isolation

Each Claude session:
- Spawns its own shell process
- Does NOT inherit the setup script's environment
- Runs independently of the setup script

```
Setup Script Process          Claude Session Process
┌─────────────────┐          ┌──────────────────┐
│ bash            │          │ New shell        │
│ ├─ nix develop  │    ✗     │ (no nix env)     │
│ └─ (exits)      │          │                  │
└─────────────────┘          └──────────────────┘
     Environment dies         Fresh environment
```

## Solutions for Nix Integration

### Option 1: Create .envrc with direnv (Recommended)

If you have direnv installed, create a `.envrc` file in the repository root:

```bash
# .envrc
use nix
```

Then in `cyrus-setup.sh`:
```bash
#!/bin/bash
# Create/update .envrc for this worktree
echo "use nix" > .envrc
# Allow direnv to run
direnv allow .
```

**Note**: This requires:
- direnv installed on the system
- Claude Code configured to respect direnv
- May not work automatically with Claude sessions

### Option 2: Create a shell wrapper script

In `cyrus-setup.sh`, create a wrapper that Claude can use:

```bash
#!/bin/bash
# cyrus-setup.sh

# Create a wrapper script that enters nix-shell
cat > run-in-nix.sh << 'EOF'
#!/bin/bash
nix develop -c "$@"
EOF

chmod +x run-in-nix.sh

echo "Created run-in-nix.sh wrapper"
echo "Usage: ./run-in-nix.sh <command>"
```

Then manually tell Claude to use: `./run-in-nix.sh bash` to start a nix shell.

### Option 3: Install dependencies directly

Instead of entering nix-shell, install required tools in the setup script:

```bash
#!/bin/bash
# cyrus-setup.sh

# Install dependencies using nix profile or home-manager
nix profile install nixpkgs#nodejs
nix profile install nixpkgs#python3

# Or copy binaries from nix store to worktree
# This is more complex but makes tools available without nix-shell
```

### Option 4: Modify Claude Code configuration (Future Enhancement)

The most robust solution would be to:
1. Configure Claude Code to always run commands through `nix develop -c`
2. This would require changes to `packages/claude-runner`
3. Add a repository config option like: `shellWrapper: "nix develop -c"`

## What the Setup Script IS Good For

The script works well for:

✅ **One-time initialization:**
```bash
#!/bin/bash
# Copy config files
cp ../shared/.env .env

# Install dependencies
pnpm install

# Build project
pnpm build

# Initialize database
./scripts/init-db.sh
```

✅ **Creating helper scripts:**
```bash
#!/bin/bash
# Create utility scripts that Claude can invoke
cat > dev.sh << 'EOF'
#!/bin/bash
nix develop -c pnpm dev
EOF
chmod +x dev.sh
```

## Testing Results

To verify this behavior, you can test with:

```bash
#!/bin/bash
# cyrus-setup.sh - Test script

echo "Setup script running..."
echo "Working directory: $(pwd)"
echo "Issue: $LINEAR_ISSUE_IDENTIFIER"

# Set an environment variable (won't persist to Claude)
export TEST_VAR="This won't be visible to Claude"

# Create a file (will persist)
echo "Setup ran at $(date)" > setup-log.txt

echo "Setup complete"
```

Then in Claude session, check:
- `cat setup-log.txt` → ✅ File exists (persists)
- `echo $TEST_VAR` → ❌ Variable empty (doesn't persist)

## Recommendations

For your use case (running `nix develop` for every agent session):

1. **Short term**: Create a wrapper script in `cyrus-setup.sh` that Claude can invoke manually
2. **Medium term**: Use direnv with `.envrc` if compatible with your setup
3. **Long term**: Request a feature in Cyrus to support shell wrappers per repository

The current architecture **cannot** automatically run every Claude command inside `nix develop` using only the setup script.
