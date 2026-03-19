---
name: verify-and-ship
description: Run all quality checks (tests, lint, typecheck), fix failures, update the changelog, commit, push, and create/update the pull request.
---

# Verify and Ship

After implementing your changes, follow these steps to verify quality and ship the work.

## 1. Acceptance Criteria Validation (CRITICAL)

Use the issue tracker `get_issue` tool to fetch the current issue details. Extract ALL acceptance criteria from the issue description and verify each one is satisfied by the implementation. If no explicit criteria exist, validate against the implied requirements from the issue title and description.

## 2. Quality Checks

Run all applicable quality checks:
- **Tests** — Run the full test suite. If tests fail, fix the issues and re-run. Retry up to 3 times. If you cannot resolve failures after 3 attempts, proceed and note the failures in your summary.
- **Linting** — Run linting tools and fix any issues found.
- **Type checking** — Run TypeScript type checking (if applicable) and fix any errors.
- **Code review** — Review your changes for quality, consistency, and best practices. Remove any debug code, console.logs, or commented-out sections.

## 3. Changelog Update

Check if the project has changelog files:
```bash
ls -la CHANGELOG.md CHANGELOG.internal.md 2>/dev/null || echo "NO_CHANGELOG"
```

If changelog files exist:
- Add an entry under `## [Unreleased]` in the appropriate subsection (`### Added`, `### Changed`, `### Fixed`, `### Removed`)
- Focus on end-user impact — be concise but descriptive
- Include the Linear issue identifier and PR link (format: `([ISSUE-ID](linear_url), [#NUMBER](PR_URL))`)
- Follow [Keep a Changelog](https://keepachangelog.com/) format

## 4. Commit and Push

- Stage all relevant changes (including changelog updates)
- Commit with clear, descriptive messages following the project's commit conventions
- Push to the remote repository

## 5. Create or Update Pull Request

Push the branch and create/update the PR:

```bash
# Push the branch
git push -u origin HEAD

# Create or verify PR exists
# IMPORTANT: --base MUST match the base_branch from the issue context
gh pr view --json url,number 2>/dev/null || gh pr create --draft --base [base_branch from context] --title "[descriptive title]" --body "Work in progress"
```

Update the PR with a comprehensive description:
- **Assignee attribution**: If `<github_username>` is available in the assignee context, add `Assignee: @username ([Display Name](linear_profile_url))` at the top of the PR body. If only a linear profile URL is available, use `Assignee: [Display Name](linear_profile_url)`.
- **Summary** of changes, implementation approach, and testing performed
- **Link** to the Linear issue
- **Cyrus marker**: Include `<!-- generated-by-cyrus -->` as a hidden HTML comment at the end of the PR body
- **Interaction tip**: Add this at the end (before the marker):
  ```
  ---
  > **Tip:** I will respond to comments that @ mention @cyrusagent on this PR. You can also submit a "changes requested" review with all your feedback at once, and I will automatically wake up to address each comment.
  ```

Remove the "WIP:" prefix from the title. Check `<agent_guidance>` — only run `gh pr ready` if guidance does NOT specify keeping PRs as drafts.

Verify the PR targets the correct base branch from `<base_branch>` in the issue context.
