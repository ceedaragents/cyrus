# GitHub PR - Pull Request Management

A draft PR exists and all changes have been committed and pushed. Now update the PR with a full description and optionally mark it as ready.

## Your Tasks

### 1. Get PR Information
First, get the current PR URL and verify the base branch:
```bash
gh pr view --json url,baseRefName -q '"\(.url) targeting \(.baseRefName)"'
```

**IMPORTANT**: Verify that the PR targets the correct base branch (from `<base_branch>` in the issue context). If it doesn't, update it:
```bash
gh pr edit --base [correct base branch]
```

### 2. Update PR with Full Description
Update the PR with a comprehensive description:
```bash
gh pr edit --title "[descriptive title]" --body "[full description]"
```

**IMPORTANT: Assignee attribution**
Check the `<assignee>` section from the issue context and add assignee information at the **very top** of the PR description body, before the summary:

- If a `<github_username>` is available, format as: `Assignee: @username ([Display Name](linear_profile_url))` — the @mention triggers a GitHub notification and the Linear profile link provides an audit trail
- If only a `<linear_profile_url>` is available (no GitHub username), format as: `Assignee: [Display Name](linear_profile_url)` using the `<linear_display_name>` and `<linear_profile_url>` values

Follow this with a blank line, then the rest of the description. If no assignee information is available at all, skip this step.

The PR description should include:
- Summary of changes
- Implementation approach
- Testing performed
- Any breaking changes or migration notes
- Link to the Linear issue

Ensure the PR has a clear, descriptive title (remove "WIP:" prefix if present).

### 3. Mark PR as Ready (CONDITIONAL)

**CRITICAL**: Before running `gh pr ready`, you MUST check the `<agent_guidance>` section in your context.

**DO NOT run `gh pr ready` if ANY of the following conditions are true:**
- The agent guidance specifies `--draft` in PR creation commands
- The agent guidance mentions keeping PRs as drafts
- The user has explicitly requested the PR remain as a draft
- The project instructions specify draft PRs

**Only if none of the above conditions apply**, convert the draft PR to ready for review:
```bash
gh pr ready
```

### 4. Final Checks
- Confirm the PR URL is valid and accessible
- Verify all commits are included in the PR
- Verify the PR targets the correct base branch (from `<base_branch>` in context)
- Check that CI/CD pipelines start running (if applicable)

## Important Notes

- **A draft PR already exists** - you're updating it and optionally marking it ready
- **All commits are pushed** - the changelog already includes the PR link
- **Be thorough with the PR description** - it should be self-contained and informative
- **RESPECT AGENT GUIDANCE** - if guidance specifies draft PRs, do NOT mark as ready
- **Verify the correct base branch** - ensure PR targets the `<base_branch>` from context
- Take as many turns as needed to complete these tasks

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max) that includes the PR URL and status:

If marked as ready:
```
PR ready at [PR URL].
```

If kept as draft (due to agent guidance or user request):
```
Draft PR updated at [PR URL] (kept as draft per guidance).
```

Example: "PR ready at https://github.com/org/repo/pull/123."
Example: "Draft PR updated at https://github.com/org/repo/pull/123 (kept as draft per guidance)."
