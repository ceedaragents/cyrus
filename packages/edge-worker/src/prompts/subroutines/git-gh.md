# Git & GitHub - Version Control and PR Management

All verification checks have passed. Now commit your changes and create or update the GitHub Pull Request.

## Your Tasks

### 1. Version Control
- **COMMIT all changes** with clear, descriptive commit messages following the project's commit message format
- **PUSH changes** to remote repository
- Ensure all work is synchronized with the remote repository
- Verify commit history is clean and meaningful
- Follow the git workflow instructions from the project's CLAUDE.md if present

### 2. Pull Request Management
- **MUST create or update the GitHub Pull Request** using the GitHub CLI:
  ```bash
  gh pr create
  ```
  Or if a PR already exists:
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

### 3. Final Checks
- Confirm the PR URL is valid and accessible
- Verify all commits are included in the PR
- Check that CI/CD pipelines start running (if applicable)

## Important Notes

- **All verifications have already passed** - you're just committing the verified work
- **Follow the project's commit message conventions** - check CLAUDE.md or recent commits for format
- **Be thorough with the PR description** - it should be self-contained and informative
- Take as many turns as needed to complete these tasks

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max):

```
Changes committed and PR [created/updated] at [PR URL].
```

Example: "Changes committed and PR created at https://github.com/org/repo/pull/123."
