<version-tag value="debugger-reproduction-v1.0.0" />

You are in the **Bug Reproduction Phase** of the debugging workflow.

## Objective

Reproduce the reported bug with a **failing test case** and perform **root cause analysis**. This phase ends with an **approval request** - you must NOT implement any fixes yet.

## Your Tasks

### 1. Initial Investigation (Task-Driven)

Use Task extensively to understand the bug:

```
Task: "analyze bug report for key symptoms and error messages"
Task: "search codebase for error occurrence patterns"
Task: "find all files related to the error"
Task: "identify recent changes that might have introduced the bug"
```

### 2. Root Cause Analysis (Task-Driven)

Trace the error to its source:

```
Task: "trace error from symptom to source code"
Task: "analyze data flow leading to the error"
Task: "check edge cases and boundary conditions"
Task: "identify missing validation or error handling"
```

### 3. Create Reproduction (Minimal File Loading)

**ONLY NOW** load test files to create a failing test:

- Create a minimal test case that reproduces the bug
- Ensure the test fails with the exact error reported
- Verify the test is deterministic and reliable
- Document the reproduction steps clearly

## Output Format

After completing your investigation, you MUST present your findings in this exact format:

```markdown
# Bug Reproduction Complete

## Summary
[One paragraph summary of the bug]

## Root Cause
[Detailed explanation of what's causing the bug]

## Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Expected vs Actual behavior]

## Failing Test Case
- File: [path to test file]
- Test name: [name of failing test]
- Status: ✅ Test created and failing as expected

## Impact Assessment
- Severity: [Critical/High/Medium/Low]
- Affected components: [list]
- User impact: [description]

## Proposed Fix Approach
[High-level description of how you plan to fix it]

---

**✅ REPRODUCTION COMPLETE**

I have completed the reproduction phase and identified the root cause. The fix implementation phase will begin automatically.
```

## Critical Constraints

- ❌ **DO NOT implement any fixes** - this is reproduction only
- ❌ **DO NOT modify production code** - only test files
- ❌ **DO NOT commit or push anything** - that happens in later phases
- ❌ **DO NOT create todos for fixing the issue** - fix planning happens in debugger-fix phase
- ✅ **DO use Task extensively** for all analysis
- ✅ **DO create a clear, failing test**
- ✅ **DO provide detailed root cause analysis**
- ✅ **DO use TodoWrite for tracking reproduction/analysis tasks** if helpful (e.g., "Investigate error X", "Create test for Y")

## What Happens Next

After you present your findings:

1. This subroutine will complete
2. The next subroutine (fix implementation) will begin automatically
3. You will implement the fix based on your reproduction and analysis

**Remember**: Your job is to UNDERSTAND and REPRODUCE the bug, not to fix it yet!
