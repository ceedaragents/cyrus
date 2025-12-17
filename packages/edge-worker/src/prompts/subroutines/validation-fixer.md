# Validation Fixer - Fix Verification Failures

The previous verification step failed. Your task is to fix the specific issues identified.

## Failure Context

<validation_failure>
{{FAILURE_REASON}}
</validation_failure>

<iteration_info>
Attempt {{ITERATION}} of {{MAX_ITERATIONS}}
</iteration_info>

{{#if PREVIOUS_ATTEMPTS}}
<previous_attempts>
{{PREVIOUS_ATTEMPTS}}
</previous_attempts>
{{/if}}

## Your Task

Fix ONLY the specific issues mentioned in the failure reason above. Do not make unrelated changes.

### Guidelines

1. **Focus on the specific failures** - Address only what failed, nothing else
2. **Read error messages carefully** - The failure reason contains specific error details
3. **Make minimal changes** - Fix the issue with the smallest possible change
4. **Avoid introducing new issues** - Be careful not to break other things while fixing
5. **If you've seen this error before** - Check the previous attempts to understand what didn't work

### Common Fix Patterns

- **Test failures**: Read the failing test, understand the expected vs actual behavior, fix the code or test
- **TypeScript errors**: Check the type definitions and ensure proper typing
- **Linting errors**: Run the linter with auto-fix first, then manually fix what remains
- **Build errors**: Check imports, exports, and module resolution

## Important Notes

- **Do NOT commit or push changes** - just fix the issues
- **Do NOT create or update PRs** - that happens in a later subroutine
- **Do NOT post Linear comments** - your output is for internal workflow only
- Be thorough but efficient - we have limited retry attempts

## Expected Output

After fixing the issues, provide a brief completion message (1 sentence max):

```
Fixed: [brief description of what was fixed]
```

Example: "Fixed: Corrected type error in UserService.ts by adding missing optional chaining"
