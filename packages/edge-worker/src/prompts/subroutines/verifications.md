# Verifications - Testing and Quality Checks

You have completed the primary work on this issue. Now perform thorough verification to ensure everything works correctly and meets quality standards.

## Your Tasks

### 1. Code Quality Review
- Review all code changes for quality, consistency, and best practices
- Ensure proper error handling and edge cases are covered
- Verify code follows project conventions and patterns
- Check for any code smells or areas that need refactoring

### 2. Testing & Verification
- Run all relevant tests and ensure they pass
- **Do NOT fix failing tests yourself** - just report the failures
- Verify the implementation meets all requirements from the issue description
- Check that existing functionality wasn't broken by the changes

### 3. Linting & Type Checking
- Run linting tools and report any issues
- Run TypeScript type checking (if applicable) and report any errors
- **Do NOT fix linting/type errors yourself** - just report them

### 4. Documentation Review
- Check if relevant documentation needs updating
- Note any debug code, console.logs, or commented-out sections that should be removed

## Important Notes

- **Do NOT commit or push changes** - that happens in a later subroutine
- **Do NOT create or update PRs** - that also happens in a later subroutine
- **Do NOT fix issues yourself** - your job is to verify and report
- **Do NOT post Linear comments** - your output is for internal workflow only
- Be thorough in running and reporting verification results

## Expected FINAL Message Output Format

You MUST respond in your FINAL message with a JSON object in exactly this format:

```json
{
  "pass": true,
  "reason": "47 tests passing, linting clean, types valid"
}
```

Or if there are failures:

```json
{
  "pass": false,
  "reason": "TypeScript error in src/services/UserService.ts:42 - Property 'email' does not exist on type 'User'. 3 tests failing in auth.test.ts"
}
```

### Output Rules

1. **pass**: Set to `true` if ALL verifications pass, `false` if ANY fail
2. **reason**:
   - If passing: Brief summary like "X tests passing, linting clean, types valid"
   - If failing: Specific error details that would help someone fix the issues

**CRITICAL**: Your entire final response message must be valid JSON matching the schema above. Do not include any text before or after the JSON.
