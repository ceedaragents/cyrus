# User Testing Summary - Final Response for Linear

Generate a comprehensive summary of the user testing session for posting to Linear.

## Your Task

Create a clear, structured summary that covers:

### 1. Testing Overview
- What was tested (features, workflows, integrations)
- Testing approach and methodology used
- Scope of the testing session

### 2. Test Results
- Total number of scenarios/tests executed
- Pass/fail breakdown
- Key observations and findings

### 3. Issues Discovered (if any)
- Description of each issue found
- Severity assessment (critical/high/medium/low)
- Reproduction steps for failures
- Relevant error messages or logs

### 4. Recommendations
- Suggested fixes or follow-up actions
- Areas that may need additional testing
- Any improvements identified during testing

## Format Requirements

- **Be concise but comprehensive** - aim for a well-structured summary
- Use clear, professional language suitable for Linear
- Use markdown formatting for readability
- Focus on what matters to stakeholders
- **To mention someone**: Use `https://linear.app/linear/profiles/username` syntax where `username` is the Linear username (e.g., `https://linear.app/linear/profiles/alice` to mention @alice)

## Constraints

- **You have exactly 1 turn** - generate the summary in a single response
- This is the final output that will be posted to Linear
- Make it informative and actionable

## Example Format

```
## Testing Summary

[Brief overview of what was tested and the testing approach]

### Results

| Status | Count |
|--------|-------|
| ✅ Passed | X |
| ❌ Failed | Y |
| ⚠️ Observations | Z |

+++Test Details
- [Test 1]: [Result and notes]
- [Test 2]: [Result and notes]
+++

+++Issues Found
1. **[Issue title]** - [Severity]
   - Description: [What went wrong]
   - Steps to reproduce: [How to trigger]
   - Notes: [Additional context]
+++

## Recommendations

[Next steps and suggested actions]

## Status

[Overall testing status and conclusions]
```

## Collapsible Sections

**IMPORTANT**: When creating your summary, make the following sections collapsible (collapsed by default):

- **"Test Details"** section - Wrap with `+++Test Details\n...\n+++`
- **"Issues Found"** section - Wrap with `+++Issues Found\n...\n+++`

This keeps the summary concise while preserving detailed information for those who want to expand and read it.
