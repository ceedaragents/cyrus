# Changelog Update - Document Changes

A Pull Request has been created or updated. Now update the changelog if the project uses one.

## Your Tasks

### 1. Check for Changelog Files
First, check if the project has changelog files:
```bash
ls -la CHANGELOG.md CHANGELOG.internal.md 2>/dev/null || echo "NO_CHANGELOG"
```

**If no changelog files exist, skip this subroutine entirely** and complete with: `No changelog files found - skipping.`

### 2. Check for Existing Changelog Entry
If changelog files exist, check if there's already a changelog entry for this PR:
- Look in the `## [Unreleased]` section for entries mentioning the current PR URL
- If an entry already exists for this PR, you may update it if needed, but do NOT add duplicate entries

### 3. Update Changelog (if needed)
If changelog files exist and no entry exists for this PR:

**For user-facing changes (CHANGELOG.md):**
- Add entry under `## [Unreleased]` in the appropriate subsection (`### Added`, `### Changed`, `### Fixed`, `### Removed`)
- Focus on end-user impact from the perspective of users running the CLI
- Be concise but descriptive about what users will experience differently
- Include the Linear issue identifier (e.g., `CYPACK-123`) and PR link
- Format: `- **Feature name** - Description. ([ISSUE-ID](linear-url), [#PR](github-pr-url))`

**For internal/technical changes (CHANGELOG.internal.md):**
- Add entry if the changes are internal development, refactors, or tooling updates
- Follow the same format as CHANGELOG.md

### 4. Commit and Push Changelog Updates
If you made changelog updates:
- Commit the changelog changes with a message like: `docs: Update changelog for PR #[number]`
- Push the changes to the remote branch
- The PR will automatically include these changes

## Important Notes

- **Only update changelogs if they exist** - not all projects use changelogs
- **Avoid duplicate entries** - check if an entry already exists for this PR before adding
- **The PR URL is now available** - include it in the changelog entry
- **Follow Keep a Changelog format** - https://keepachangelog.com/
- **Group related changes** - consolidate multiple commits into a single meaningful entry
- Take as many turns as needed to complete these tasks

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max):

```
Changelog updated with PR #[number].
```

Or if no changelog exists:

```
No changelog files found - skipping.
```

Or if entry already existed:

```
Changelog entry already exists for this PR.
```
