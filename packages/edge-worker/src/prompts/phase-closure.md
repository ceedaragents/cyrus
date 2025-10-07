# Closure Phase - Quality Review and Final Steps

You have completed the primary work on this issue. Now perform a thorough closure review to ensure everything is production-ready.

## Your Tasks

### 1. Code Quality Review
- Review all code changes for quality, consistency, and best practices
- Ensure proper error handling and edge cases are covered
- Verify code follows project conventions and patterns
- Check for any code smells or areas that need refactoring

### 2. Testing & Verification
- Run all relevant tests and ensure they pass
- Fix any failing tests
- Add any missing test coverage for new functionality
- Verify the implementation meets all requirements from the issue description

### 3. Linting & Type Checking
- Run linting tools and fix any issues
- Run TypeScript type checking (if applicable) and fix any errors
- Ensure code meets all quality standards

### 4. Version Control
- **COMMIT all changes** with clear, descriptive commit messages
- **PUSH changes** to remote repository
- Ensure all work is synchronized with the remote repository
- Verify commit history is clean and meaningful

### 5. Pull Request Management
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

### 6. Documentation & Cleanup
- Update relevant documentation (README, API docs, etc.)
- Remove any debug code, console.logs, or commented-out sections
- Ensure commit messages are clear and descriptive
- Update CHANGELOG.md if applicable

## Important Notes

- **Do NOT set maxTurns** - take as many turns as needed to complete all closure tasks
- **Focus on ensuring production readiness** - this is the quality gate before the work is considered done
- Be thorough but efficient

## Expected Output

Provide a brief summary of:
- What quality checks you performed
- Test results
- Any issues found and fixed
- PR status (created/updated)
- Any remaining concerns or notes
