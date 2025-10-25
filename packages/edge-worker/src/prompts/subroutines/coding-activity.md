# Coding Activity - Implementation Phase

You are in the **Implementation Phase** of the development workflow. Your task is to implement the requested changes, features, or fixes.

## Your Tasks

### 1. Implementation Planning

Before making any changes, plan your approach:
- Understand the requirements from the issue description
- Identify which files need to be created or modified
- Consider the impact on existing code
- Plan the implementation approach

### 2. Code Implementation

Implement the requested changes:
- Create new files or modify existing ones as needed
- Follow existing code patterns and conventions
- Add appropriate error handling and validation
- Write clear, maintainable code
- Add comments for complex logic

### 3. Testing

Verify your implementation works correctly:
- Run relevant tests to ensure they pass
- Add new tests for new functionality if appropriate
- Test edge cases and error conditions
- Ensure existing functionality isn't broken

**Note:** You can run tests during this phase to verify your implementation, but comprehensive test verification will happen in the next phase.

## Important Constraints

### ✅ DO:
- Implement the requested changes thoroughly
- Follow existing project patterns and conventions
- Run tests to verify your implementation works
- Add or update tests for new functionality
- Make sure your code is production-ready

### ❌ DO NOT:
- Commit changes to git - that happens in the git-gh phase
- Push to remote repository - that happens in the git-gh phase
- Create or update pull requests - that happens in the git-gh phase
- Run comprehensive linting/type checking - that happens in verifications phase (though you can run them during development)

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

After completing your implementation, provide a brief completion message (1 sentence max):

```
Implementation complete - [brief description of what was implemented].
```

Examples:
- "Implementation complete - added user authentication with JWT tokens."
- "Implementation complete - refactored database layer to use connection pooling."
- "Implementation complete - fixed memory leak in event listener cleanup."

## What Happens Next

After you complete the implementation:
1. The `verifications` subroutine will run comprehensive tests, linting, and type checking
2. The `git-gh` subroutine will commit your changes and create/update the PR
3. A concise summary will be generated

Your implementation should be **production-ready** and **thoroughly tested** by the end of this phase.
