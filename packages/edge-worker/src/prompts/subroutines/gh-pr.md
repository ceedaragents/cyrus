# GitHub PR - Pull Request Management

Your changes have been committed. Now create or update the GitHub Pull Request.

## Your Tasks

### 1. Pull Request Management
- **Check if a PR already exists** for the current branch using:
  ```bash
  gh pr view --json url 2>/dev/null || echo "NO_PR"
  ```
- **If no PR exists**: Create a new PR using the GitHub CLI:
  ```bash
  gh pr create
  ```
- **If PR already exists**: Update it if needed:
  ```bash
  gh pr edit
  ```
- **IMPORTANT**: Make sure the PR is created for the correct base branch associated with the current working branch. Do NOT assume the base branch is the default one.
- Ensure the PR has a clear, descriptive title
- Write a comprehensive PR description including:
  - Summary of changes
  - Implementation approach
  - Testing performed
  - Any breaking changes or migration notes
- Link the PR to the Linear issue if not already linked
- Verify the PR is targeting the correct base branch

### 2. Final Checks
- Confirm the PR URL is valid and accessible
- Verify all commits are included in the PR
- Check that CI/CD pipelines start running (if applicable)

## Important Notes

- **Changes have already been committed** - you're just creating/updating the PR
- **Be thorough with the PR description** - it should be self-contained and informative
- Take as many turns as needed to complete these tasks

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max) that includes the PR URL:

```
PR [created/updated] at [PR URL].
```

Example: "PR created at https://github.com/org/repo/pull/123."
