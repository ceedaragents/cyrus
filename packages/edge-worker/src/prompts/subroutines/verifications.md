# Verifications - Testing and Quality Checks

You have completed the primary work on this issue. Now perform thorough verification to ensure everything works correctly and meets quality standards.

## Your Tasks

### 1. Acceptance Criteria Validation (CRITICAL - Do This First)

Use the issue tracker `get_issue` tool to fetch the current issue details. The issue identifier is available in your conversation context (e.g., "CYPACK-123").

**Steps:**
1. Fetch the issue using the issue tracker `get_issue` tool with the issue identifier
2. Extract ALL acceptance criteria from the issue description (look for bullet points, numbered lists, checkboxes, or sections labeled "Acceptance Criteria", "Requirements", "Definition of Done", etc.)
3. For EACH acceptance criterion, verify that the implementation satisfies it
4. Document which criteria pass and which fail

**Important:** If no explicit acceptance criteria are found, extract implied requirements from the issue title and description. Every issue has requirements that must be verified.

### 2. Code Quality Review
- Review all code changes for quality, consistency, and best practices
- Ensure proper error handling and edge cases are covered
- Verify code follows project conventions and patterns
- Check for any code smells or areas that need refactoring

### 3. Testing & Verification
- Run all relevant tests and ensure they pass
- **Do NOT fix failing tests yourself** - just report the failures
- Verify the implementation meets all requirements from the issue description
- Check that existing functionality wasn't broken by the changes

### 4. Linting & Type Checking
- Run linting tools and report any issues
- Run TypeScript type checking (if applicable) and report any errors
- **Do NOT fix linting/type errors yourself** - just report them

### 5. Documentation Review
- Check if relevant documentation needs updating
- Note any debug code, console.logs, or commented-out sections that should be removed

## Important Notes

- **Do NOT commit or push changes** - that happens in a later subroutine
- **Do NOT create or update PRs** - that also happens in a later subroutine
- **Do NOT touch the changelog** - a separate subroutine handles changelog updates
- **Do NOT fix issues yourself** - your job is to verify and report
- **Do NOT post Linear comments** - your output is for internal workflow only
- Be thorough in running and reporting verification results
- **Acceptance criteria validation is MANDATORY** - failing to validate against acceptance criteria counts as a failed verification

## Expected FINAL Message Output Format

You MUST respond in your FINAL message with a JSON object in exactly this format:

```json
{
  "pass": true,
  "reason": "All 3 acceptance criteria met. 47 tests passing, linting clean, types valid"
}
```

Or if there are failures:

```json
{
  "pass": false,
  "reason": "Acceptance criteria failed: 'Support pagination' not implemented. TypeScript error in src/services/UserService.ts:42 - Property 'email' does not exist on type 'User'. 3 tests failing in auth.test.ts"
}
```

### Output Rules

1. **pass**: Set to `true` if ALL verifications pass (including ALL acceptance criteria), `false` if ANY fail
2. **reason**:
   - If passing: Brief summary that mentions acceptance criteria status, e.g., "All X acceptance criteria met. Y tests passing, linting clean, types valid"
   - If failing: Specific error details that would help someone fix the issues. **Always list any failing acceptance criteria first**, then other failures.

**CRITICAL**: Your entire final response message must be valid JSON matching the schema above. Do not include any text before or after the JSON.
