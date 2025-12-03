# F1 Test Drive Template

This template defines the standard format for F1 test drives - standardized test problems used to evaluate the Cyrus product pipeline end-to-end.

## Purpose

F1 test drives are used to:
- Test Cyrus's ability to process Linear issues into working code
- Validate the full pipeline (Linear → Cyrus → Git worktree → Claude Code → Tests → Completion)
- Benchmark performance and quality across different configurations
- Regression test the Cyrus product as it evolves

## Input Format

Each F1 test drive requires:

### 1. Linear Issue Structure

```markdown
**Title**: [Feature/Task Description]

**Description**:
- Clear problem statement
- Acceptance criteria (checkboxes)
- Links to test problem files
- Expected verification commands

**Labels**:
- `f1-test-drive`
- Model/configuration labels (e.g., `sonnet`, `haiku`)

**Assignment**:
- Assign to Cyrus agent to trigger processing
```

### 2. Test Problem Repository

The test problem should be a standalone directory containing:

```
test-problem/
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vitest.config.ts      # Test framework config
├── .gitignore           # Ignore patterns
├── README.md            # Problem description and acceptance criteria
└── src/
    ├── implementation.ts       # Stub/skeleton code with TODOs
    └── implementation.test.ts  # Complete test suite
```

**Key characteristics**:
- Self-contained (installable with `pnpm install`)
- Complete test suite with failing tests
- Clear TODO comments in implementation
- Well-documented acceptance criteria
- Runnable verification commands

### 3. Acceptance Criteria Structure

Acceptance criteria should be:

✅ **Specific**: Clear, measurable outcomes
✅ **Verifiable**: Can be checked with commands
✅ **Self-contained**: No external dependencies
✅ **Documented**: Expected behavior is explicit

**Example**:
```markdown
## Acceptance Criteria

- [ ] All tests pass (`pnpm test`)
- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] Implementation uses sliding window algorithm
- [ ] Edge cases handled (empty IDs, large limits, etc.)
- [ ] Code is type-safe (no `any` types)
```

## Verification Commands

Each test drive must specify commands to verify success:

### Required Verification Steps

1. **Installation check**:
   ```bash
   cd [test-problem-dir]
   pnpm install
   ```

2. **Test execution**:
   ```bash
   pnpm test
   ```
   - Expected: All tests pass (0 failed)

3. **Type checking**:
   ```bash
   pnpm typecheck
   ```
   - Expected: No TypeScript errors

4. **Optional: Linting**:
   ```bash
   pnpm lint
   ```

5. **Optional: Build**:
   ```bash
   pnpm build
   ```

### Verification Output Format

Document expected outputs for each command:

```markdown
## Expected Outcomes

### Success Indicators
✅ All tests pass (X tests, 0 failed)
✅ TypeScript compilation succeeds
✅ [Specific implementation requirements met]

### Failure Indicators
❌ Any test failures
❌ TypeScript compilation errors
❌ [Specific anti-patterns present]
```

## Success/Failure Indicators

### Success Criteria

A test drive is **successful** when:

1. ✅ **All tests pass**: 100% test success rate
2. ✅ **Type safety**: No TypeScript errors or warnings
3. ✅ **Acceptance criteria met**: All checkboxes verified
4. ✅ **Code quality**: Follows best practices (no `any`, clean code)
5. ✅ **Complete implementation**: No TODO comments remaining
6. ✅ **Git hygiene**: Proper commits, no untracked files

### Failure Criteria

A test drive **fails** when:

1. ❌ **Test failures**: Any test does not pass
2. ❌ **Type errors**: TypeScript compilation fails
3. ❌ **Incomplete**: TODO comments remain, methods not implemented
4. ❌ **Wrong algorithm**: Implementation doesn't meet specification
5. ❌ **Type safety violations**: Use of `any` or type workarounds
6. ❌ **Timeout**: Exceeds maximum processing time (configurable)

### Partial Success (for evaluation)

Track these metrics even if the test passes:

- ⏱️ **Time to completion**: How long did Cyrus take?
- 💬 **Iterations**: How many Claude Code turns were needed?
- 📊 **Test pass rate**: Percentage of tests passing
- 🔄 **Retries**: How many attempts before success?
- 📝 **Code quality**: Subjective assessment of implementation quality

## Test Drive Lifecycle

### 1. Setup Phase
- Create Linear issue with test drive details
- Link to test problem repository
- Set labels and configuration
- Assign to Cyrus agent

### 2. Processing Phase
- Cyrus picks up the issue
- Creates Git worktree
- Runs Claude Code session
- Implements solution
- Runs tests iteratively

### 3. Verification Phase
- Run all verification commands
- Check acceptance criteria
- Collect metrics (time, iterations, quality)
- Document results

### 4. Completion Phase
- Mark Linear issue complete
- Post summary comment with results
- Clean up Git worktree
- Archive metrics for analysis

## Example: Rate Limiter Test Drive

See `spec/f1/test-repo/` for a complete example:

**Problem**: Implement a rate limiter using sliding window algorithm

**Input**: Linear issue with:
- Description of rate limiting requirements
- Link to `spec/f1/test-repo/`
- Acceptance criteria checkboxes

**Expected Output**:
- Implemented `src/rate-limiter.ts`
- All 40+ tests passing
- No TypeScript errors
- Clean, type-safe code

**Verification**:
```bash
cd spec/f1/test-repo
pnpm install
pnpm test      # All tests pass
pnpm typecheck # No errors
```

## Creating New Test Drives

To create a new F1 test drive:

1. **Design the problem**:
   - Choose a simple, well-defined task
   - Write comprehensive test suite
   - Create stub implementation with TODOs
   - Document acceptance criteria

2. **Set up the repository**:
   - Follow the directory structure above
   - Include package.json with test scripts
   - Add TypeScript and test configuration
   - Write clear README.md

3. **Create Linear issue template**:
   - Use `f1-test-drive` label
   - Link to test problem directory
   - List verification commands
   - Define success/failure indicators

4. **Test the test drive**:
   - Manually verify the problem is solvable
   - Ensure tests are comprehensive
   - Confirm verification commands work
   - Run through the full lifecycle once

## Best Practices

### Problem Design

- ✅ **Keep it simple**: Focus on testing the pipeline, not the problem complexity
- ✅ **Make it realistic**: Should resemble real-world engineering tasks
- ✅ **Be specific**: Clear requirements, no ambiguity
- ✅ **Test thoroughly**: Comprehensive test coverage including edge cases

### Test Suite Design

- ✅ **Cover happy path**: Basic functionality works
- ✅ **Test edge cases**: Empty inputs, large numbers, special characters
- ✅ **Test error handling**: Invalid inputs, boundary conditions
- ✅ **Be deterministic**: Tests should not be flaky
- ✅ **Be fast**: Test suite should run in seconds, not minutes

### Documentation

- ✅ **Clear acceptance criteria**: Checkboxes with specific requirements
- ✅ **Verification commands**: Exact commands to run
- ✅ **Expected outcomes**: What success and failure look like
- ✅ **Implementation guidance**: TODO comments in code

### Metrics Collection

Track these for each test drive:
- Time to completion (wall clock)
- Number of Claude Code iterations
- Test pass rate progression
- Code quality assessment
- Any errors or issues encountered

## Future Enhancements

Potential improvements to the F1 framework:
- Automated test drive execution
- Performance benchmarking dashboard
- Multiple difficulty levels
- Language-specific test problems
- Integration with CI/CD pipeline
