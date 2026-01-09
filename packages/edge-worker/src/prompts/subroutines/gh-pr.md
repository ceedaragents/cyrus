# GitHub PR - Pull Request Management

A draft PR exists and all changes have been committed and pushed. Now update the PR with a full description and mark it as ready.

## Your Tasks

### 1. Get PR Information
First, get the current PR URL:
```bash
gh pr view --json url -q '.url'
```

### 2. Update PR with Full Description
Update the PR with a comprehensive description:
```bash
gh pr edit --title "[descriptive title]" --body "[full description]"
```

The PR description should include:
- Summary of changes
- Implementation approach
- Testing performed
- Any breaking changes or migration notes
- Link to the Linear issue

Ensure the PR has a clear, descriptive title (remove "WIP:" prefix if present).

### 3. Mark PR as Ready
Convert the draft PR to ready for review:
```bash
gh pr ready
```

Unless the project instructions specify to keep it as draft, or the user has requested it remain as draft.

### 4. Final Checks
- Confirm the PR URL is valid and accessible
- Verify all commits are included in the PR
- Check that CI/CD pipelines start running (if applicable)

## Important Notes

- **A draft PR already exists** - you're updating it and marking it ready
- **All commits are pushed** - the changelog already includes the PR link
- **Be thorough with the PR description** - it should be self-contained and informative
- **Verify the correct base branch** - ensure PR targets the right base branch
- Take as many turns as needed to complete these tasks

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max) that includes the PR URL:

```
PR ready at [PR URL].
```

Example: "PR ready at https://github.com/org/repo/pull/123."
