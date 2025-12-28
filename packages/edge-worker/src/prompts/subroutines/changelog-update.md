# Changelog Update - Document Changes

All verification checks have passed. Now update the changelog if the project uses one.

## Your Tasks

### 1. Push Current Branch and Create Draft PR
First, push the current branch (even if there are no new commits) and create a draft PR to get a PR number:

```bash
# Push the branch to remote
git push -u origin HEAD

# Check if PR already exists, if not create a draft PR
gh pr view --json url,number 2>/dev/null || gh pr create --draft --title "WIP: [brief description]" --body "Work in progress for [ISSUE-ID]. Full description to follow."
```

Record the PR URL and number for use in the changelog entry.

### 2. Check for Changelog Files
Check if the project has changelog files:
```bash
ls -la CHANGELOG.md CHANGELOG.internal.md 2>/dev/null || echo "NO_CHANGELOG"
```

**If no changelog files exist, complete with:** `Draft PR created at [PR URL]. No changelog files found.`

### 3. Check for Existing Changelog Entry
If changelog files exist, check if there's already a changelog entry for this issue:
- Look in the `## [Unreleased]` section for entries mentioning the current Linear issue identifier
- If an entry already exists for this issue, you may update it to add the PR link, but do NOT add duplicate entries

### 4. Update Changelog with PR Link
If changelog files exist and no entry exists (or entry needs PR link):

**For user-facing changes (CHANGELOG.md):**
- Add entry under `## [Unreleased]` in the appropriate subsection (`### Added`, `### Changed`, `### Fixed`, `### Removed`)
- Focus on end-user impact from the perspective of users running the CLI
- Be concise but descriptive about what users will experience differently
- Include both the Linear issue identifier AND the PR link
- Format: `- **Feature name** - Description. ([ISSUE-ID](https://linear.app/...), [#NUMBER](PR_URL))`

**For internal/technical changes (CHANGELOG.internal.md):**
- Add entry if the changes are internal development, refactors, or tooling updates
- Follow the same format as CHANGELOG.md

## Important Notes

- **Create draft PR first** - this gives you the PR number to include in the changelog
- **Only update changelogs if they exist** - not all projects use changelogs
- **Avoid duplicate entries** - check if an entry already exists for this issue before adding
- **Follow Keep a Changelog format** - https://keepachangelog.com/
- **Group related changes** - consolidate multiple commits into a single meaningful entry
- **Do NOT commit or push the changelog changes** - that happens in the next subroutine
- Take as many turns as needed to complete these tasks

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max):

```
Draft PR created at [PR URL]. Changelog updated for [ISSUE-ID].
```

Or if no changelog exists:

```
Draft PR created at [PR URL]. No changelog files found.
```

Or if entry already existed:

```
Draft PR created at [PR URL]. Changelog entry already exists for this issue.
```
