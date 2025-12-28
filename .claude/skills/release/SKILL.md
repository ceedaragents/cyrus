---
name: release
description: Run a Cyrus release by publishing all packages to npm in the correct dependency order, updating changelogs, and creating git tags.
---

# Release

Publish Cyrus packages to npm and create a release.

## Pre-Publishing Checklist

1. **Update CHANGELOG.md and CHANGELOG.internal.md**:
   - Move items from `## [Unreleased]` to a new versioned section in both files
   - Use the CLI version number (e.g., `## [0.1.22] - 2025-01-06`)
   - CHANGELOG.md: Focus on end-user impact from the perspective of the `cyrus` CLI
   - CHANGELOG.internal.md: Internal development changes, refactors, and tooling updates

2. **Check Linear Issues**:
   - Review all Linear issues mentioned in the Unreleased changelog
   - These will be moved from 'MergedUnreleased' to 'ReleasedMonitoring' after release

3. **Commit all changes**:
   ```bash
   git add -A
   git commit -m "Prepare release v0.1.XX"
   git push
   ```

## Publishing Workflow

### 1. Install dependencies from root
```bash
pnpm install  # Ensures all workspace dependencies are up to date
```

### 2. Build all packages from root first
```bash
pnpm build  # Builds all packages to ensure dependencies are resolved
```

### 3. Publish packages in dependency order

**IMPORTANT**: Publish in this exact order to avoid dependency resolution issues:

```bash
# 1. Packages with no internal dependencies
cd packages/ndjson-client && pnpm publish --access public --no-git-checks
cd ../..
pnpm install  # Update lockfile

# 2. Packages that depend on external deps only
cd packages/claude-runner && pnpm publish --access public --no-git-checks
cd ../..
pnpm install  # Update lockfile

# 3. Core package (depends on claude-runner)
cd packages/core && pnpm publish --access public --no-git-checks
cd ../..
pnpm install  # Update lockfile

# 4. Simple agent runner (depends on claude-runner)
cd packages/simple-agent-runner && pnpm publish --access public --no-git-checks
cd ../..
pnpm install  # Update lockfile

# 5. Edge worker (depends on core, claude-runner, ndjson-client, simple-agent-runner)
cd packages/edge-worker && pnpm publish --access public --no-git-checks
cd ../..
pnpm install  # Update lockfile
```

### 4. Publish the CLI
```bash
pnpm install  # Final install to ensure all deps are latest
cd apps/cli && pnpm publish --access public --no-git-checks
cd ../..
```

### 5. Create git tag and push
```bash
git tag v0.1.XX
git push origin <branch-name>
git push origin v0.1.XX
```

### 6. Update Linear Issues
After a successful release, move each Linear issue mentioned in the changelog from 'MergedUnreleased' (Done) status to 'ReleasedMonitoring' (also Done) status.

## Key Notes

- Always use `--no-git-checks` flag to publish from feature branches
- Run `pnpm install` after each publish to update the lockfile
- The `simple-agent-runner` package MUST be published before `edge-worker`
- Build all packages once at the start, then publish without rebuilding
- This ensures `workspace:*` references resolve to published versions

## Examples

- "release" - Run the full release process
- "/release" - Invoke the release skill
