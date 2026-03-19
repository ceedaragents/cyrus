# Debug and Fix

Reproduce the reported bug, identify the root cause, and implement a targeted fix.

## Phase 1: Reproduction and Root Cause Analysis

Use Task extensively to understand the bug:
- Analyze the bug report for key symptoms and error messages
- Search the codebase for error occurrence patterns
- Trace the error from symptom to source code
- Analyze data flow and check edge cases
- Identify recent changes that might have introduced the bug

Create a **failing test case** that reproduces the bug:
- Ensure the test fails with the exact error reported
- Verify the test is deterministic and reliable

## Phase 2: Fix Implementation

Implement a **minimal, targeted fix**:
- Fix the bug and nothing more — avoid unrelated improvements
- Follow existing code patterns and conventions
- Add comments if the fix is non-obvious
- The fix must make the failing test pass

## Phase 3: Verification

After implementing the fix:
- Run the failing test to confirm it now passes
- Run the full test suite to check for regressions
- Verify edge cases are handled
- Check that error messages are clear

When the fix is verified, proceed to the shipping phase of the workflow.