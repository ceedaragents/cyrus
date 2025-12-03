# F1 Test Drive: Rate Limiter Implementation Challenge

This is a standardized test problem for the F1 testing framework in Cyrus. The goal is to test the Cyrus product pipeline end-to-end by implementing a simple rate limiter library.

## Problem Description

Implement a **rate limiter using the sliding window algorithm** that tracks and limits requests per client.

### Requirements

The `RateLimiter` class must:

1. **Accept configuration** with:
   - `windowMs`: Time window in milliseconds
   - `maxRequests`: Maximum number of requests allowed within the window

2. **Track requests per client** using a sliding window algorithm:
   - Each client is identified by a unique `clientId` string
   - Requests are tracked with timestamps
   - Old requests outside the current window are automatically discarded

3. **Implement `isAllowed(clientId: string): boolean`**:
   - Returns `true` if the request is allowed (under the limit)
   - Returns `false` if the rate limit has been exceeded
   - Records the request if allowed

4. **Implement `getRequestCount(clientId: string): number`**:
   - Returns the number of requests in the current window for a client
   - Only counts requests within the active time window

5. **Provide reset functionality**:
   - `reset()`: Clear all client records
   - `resetClient(clientId: string)`: Clear records for a specific client

### Sliding Window Algorithm

The sliding window algorithm should:
- Use the current timestamp as the end of the window
- The window start is `current timestamp - windowMs`
- Only count requests within `[window start, current timestamp]`
- Automatically expire old requests that fall outside the window

**Example**:
```
windowMs = 1000ms (1 second)
maxRequests = 3

Timeline:
t=0ms    -> Request 1: ALLOWED (count: 1)
t=100ms  -> Request 2: ALLOWED (count: 2)
t=200ms  -> Request 3: ALLOWED (count: 3)
t=300ms  -> Request 4: BLOCKED (count: 3, limit reached)
t=1100ms -> Request 5: ALLOWED (Request 1 is now outside window, count: 3)
```

## Project Setup

### Installation

```bash
pnpm install
```

### Running Tests

```bash
# Run tests once
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type check
pnpm typecheck
```

## Acceptance Criteria

### Functional Requirements

- ✅ **Basic rate limiting**: Allow up to `maxRequests` within `windowMs`, block subsequent requests
- ✅ **Per-client tracking**: Different clients have independent rate limits
- ✅ **Sliding window**: Requests expire after `windowMs`, allowing new requests
- ✅ **Request counting**: `getRequestCount()` accurately reflects current window
- ✅ **Reset functionality**: Both `reset()` and `resetClient()` work correctly

### Test Coverage

All tests in `src/rate-limiter.test.ts` must pass:

- ✅ Allow requests within the limit
- ✅ Block requests that exceed the limit
- ✅ Track requests separately for different clients
- ✅ Allow requests after the window expires
- ✅ Implement sliding window correctly (not fixed window)
- ✅ Return accurate request counts
- ✅ Handle custom configurations (different window sizes and max requests)
- ✅ Handle edge cases (empty IDs, special characters, maxRequests=1, large maxRequests)

### Code Quality

- ✅ **Type safety**: No TypeScript errors, strict mode enabled
- ✅ **No `any` types**: All types must be explicit
- ✅ **Clean implementation**: Readable, maintainable code
- ✅ **Efficient**: Use appropriate data structures (Map for client tracking)

## Verification Commands

After implementation, verify success with:

```bash
# Install dependencies
pnpm install

# Run all tests (should all pass)
pnpm test

# Type check (should have no errors)
pnpm typecheck
```

## Expected Outcomes

### Success Indicators

✅ All tests pass (0 failed)
✅ TypeScript compilation succeeds with no errors
✅ Implementation uses sliding window (not fixed window)
✅ Code is clean and well-structured

### Failure Indicators

❌ Any test failures
❌ TypeScript compilation errors
❌ Implementation uses fixed window instead of sliding window
❌ Use of `any` types or other type safety violations

## Implementation Notes

### Current State

The project includes:
- Complete test suite in `src/rate-limiter.test.ts`
- Stub implementation in `src/rate-limiter.ts` with TODO comments
- TypeScript and Vitest configuration

### What You Need to Do

Implement the missing methods in `src/rate-limiter.ts`:
1. `isAllowed(clientId: string): boolean`
2. `getRequestCount(clientId: string): number`

The skeleton code includes:
- Type definitions (`RateLimiterConfig`, `RequestRecord`)
- Class structure with constructor
- Method signatures
- TODO comments indicating implementation steps
- Helper methods (`reset()`, `resetClient()`)

### Tips

- Use `Date.now()` to get current timestamp
- Store requests as `RequestRecord[]` in the `requests` Map
- Filter out expired requests before checking the count
- Remember to record the request if it's allowed in `isAllowed()`

## Why This Test Problem?

This rate limiter problem is ideal for F1 testing because it:
- **Simple enough** to implement in a reasonable time
- **Complex enough** to test real coding capabilities
- **Well-defined** with clear acceptance criteria
- **Self-verifying** with comprehensive test suite
- **Realistic** - similar to real-world engineering tasks
- **Repeatable** - same problem can be used for multiple test runs

## License

MIT
