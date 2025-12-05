/**
 * Template files for the test rate limiter repository
 * These are exported as string constants for dynamic generation
 */

export const PACKAGE_JSON_TEMPLATE = `{
  "name": "simple-rate-limiter",
  "version": "0.1.0",
  "description": "A simple, flexible rate limiter library with multiple algorithm support",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "echo \\"Error: no tests yet\\" && exit 1",
    "typecheck": "tsc --noEmit"
  },
  "keywords": [
    "rate-limiter",
    "rate-limiting",
    "throttle",
    "token-bucket",
    "sliding-window"
  ],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}`;

export const TSCONFIG_JSON_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}`;

export const TYPES_TS_TEMPLATE = `/**
 * Type definitions for the rate limiter library
 */

/**
 * Algorithm types supported by the rate limiter
 */
export type RateLimitAlgorithm = 'token-bucket' | 'sliding-window' | 'fixed-window';

/**
 * Configuration for token bucket algorithm
 */
export interface TokenBucketConfig {
  /** Algorithm type */
  algorithm: 'token-bucket';
  /** Maximum number of tokens in the bucket */
  capacity: number;
  /** Number of tokens to refill per interval */
  refillRate: number;
  /** Refill interval in milliseconds */
  refillInterval: number;
}

/**
 * Configuration for sliding window algorithm
 * TODO: Implement sliding window algorithm
 */
export interface SlidingWindowConfig {
  /** Algorithm type */
  algorithm: 'sliding-window';
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Configuration for fixed window algorithm
 * TODO: Implement fixed window algorithm
 */
export interface FixedWindowConfig {
  /** Algorithm type */
  algorithm: 'fixed-window';
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Union type of all rate limit configurations
 */
export type RateLimitConfig = TokenBucketConfig | SlidingWindowConfig | FixedWindowConfig;

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of tokens/requests remaining */
  remaining: number;
  /** Time in milliseconds until the next token/request is available */
  retryAfter?: number;
  /** Current limit (capacity or max requests) */
  limit: number;
}

/**
 * Storage adapter interface for persisting rate limit state
 * TODO: Implement Redis adapter
 */
export interface StorageAdapter {
  /** Get the current state for a key */
  get(key: string): Promise<RateLimitState | null>;
  /** Set the state for a key */
  set(key: string, state: RateLimitState): Promise<void>;
  /** Delete the state for a key */
  delete(key: string): Promise<void>;
}

/**
 * Internal state representation for rate limiters
 */
export interface RateLimitState {
  /** Tokens available (for token bucket) */
  tokens?: number;
  /** Last refill timestamp (for token bucket) */
  lastRefill?: number;
  /** Request timestamps (for sliding window) */
  requests?: number[];
  /** Current window start (for fixed window) */
  windowStart?: number;
  /** Request count in current window (for fixed window) */
  requestCount?: number;
}
`;

export const RATE_LIMITER_TS_TEMPLATE = `import type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitState,
  StorageAdapter,
  TokenBucketConfig,
} from './types.js';

/**
 * In-memory storage adapter for development and testing
 */
class MemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, RateLimitState>();

  async get(key: string): Promise<RateLimitState | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, state: RateLimitState): Promise<void> {
    this.store.set(key, state);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Simple rate limiter with multiple algorithm support
 *
 * Currently implemented:
 * - Token bucket algorithm
 *
 * TODO:
 * - Sliding window algorithm
 * - Fixed window algorithm
 * - Redis storage adapter
 * - Unit tests
 */
export class RateLimiter {
  private storage: StorageAdapter;

  constructor(
    private config: RateLimitConfig,
    storage?: StorageAdapter,
  ) {
    this.storage = storage ?? new MemoryStorageAdapter();
  }

  /**
   * Check if a request is allowed for the given key
   * @param key - Identifier for the rate limit (e.g., user ID, IP address)
   * @returns Rate limit result with allowed status and remaining capacity
   */
  async check(key: string): Promise<RateLimitResult> {
    switch (this.config.algorithm) {
      case 'token-bucket':
        return this.checkTokenBucket(key, this.config);
      case 'sliding-window':
        throw new Error('Sliding window algorithm not yet implemented');
      case 'fixed-window':
        throw new Error('Fixed window algorithm not yet implemented');
      default:
        // This should never happen due to TypeScript's exhaustiveness checking
        const _exhaustive: never = this.config;
        throw new Error(\`Unknown algorithm: \${(_exhaustive as RateLimitConfig).algorithm}\`);
    }
  }

  /**
   * Consume a token/request for the given key
   * @param key - Identifier for the rate limit
   * @param tokens - Number of tokens to consume (default: 1)
   * @returns Rate limit result
   */
  async consume(key: string, tokens = 1): Promise<RateLimitResult> {
    const result = await this.check(key);

    if (!result.allowed) {
      return result;
    }

    // Consume the tokens
    switch (this.config.algorithm) {
      case 'token-bucket':
        await this.consumeTokenBucket(key, this.config, tokens);
        break;
      case 'sliding-window':
        throw new Error('Sliding window algorithm not yet implemented');
      case 'fixed-window':
        throw new Error('Fixed window algorithm not yet implemented');
    }

    return {
      ...result,
      remaining: Math.max(0, result.remaining - tokens),
    };
  }

  /**
   * Reset the rate limit for a given key
   * @param key - Identifier for the rate limit
   */
  async reset(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  /**
   * Token bucket algorithm implementation
   */
  private async checkTokenBucket(
    key: string,
    config: TokenBucketConfig,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const state = await this.storage.get(key);

    let tokens = config.capacity;
    let lastRefill = now;

    if (state?.tokens !== undefined && state?.lastRefill !== undefined) {
      // Calculate tokens to add based on time elapsed
      const timeSinceRefill = now - state.lastRefill;
      const intervalsElapsed = Math.floor(timeSinceRefill / config.refillInterval);
      const tokensToAdd = intervalsElapsed * config.refillRate;

      tokens = Math.min(config.capacity, state.tokens + tokensToAdd);
      lastRefill = state.lastRefill + (intervalsElapsed * config.refillInterval);
    }

    // Save updated state
    await this.storage.set(key, { tokens, lastRefill });

    const allowed = tokens >= 1;
    const retryAfter = allowed ? undefined : config.refillInterval;

    return {
      allowed,
      remaining: Math.floor(tokens),
      retryAfter,
      limit: config.capacity,
    };
  }

  /**
   * Consume tokens from the bucket
   */
  private async consumeTokenBucket(
    key: string,
    _config: TokenBucketConfig,
    tokensToConsume: number,
  ): Promise<void> {
    const state = await this.storage.get(key);

    if (!state || state.tokens === undefined) {
      throw new Error('Invalid state: cannot consume tokens before check');
    }

    const newTokens = Math.max(0, state.tokens - tokensToConsume);
    await this.storage.set(key, { ...state, tokens: newTokens });
  }

  /**
   * TODO: Implement sliding window algorithm
   *
   * Sliding window maintains a list of request timestamps and counts
   * requests within the current window. This provides more accurate
   * rate limiting than fixed windows at the cost of more memory.
   */
  private async checkSlidingWindow(_key: string): Promise<RateLimitResult> {
    throw new Error('Not implemented');
  }

  /**
   * TODO: Implement fixed window algorithm
   *
   * Fixed window resets the counter at fixed intervals. Simple and
   * memory-efficient but can allow bursts at window boundaries.
   */
  private async checkFixedWindow(_key: string): Promise<RateLimitResult> {
    throw new Error('Not implemented');
  }
}
`;

export const INDEX_TS_TEMPLATE = `/**
 * Simple rate limiter library
 *
 * Provides flexible rate limiting with multiple algorithm support:
 * - Token bucket (implemented)
 * - Sliding window (TODO)
 * - Fixed window (TODO)
 *
 * @packageDocumentation
 */

export { RateLimiter } from './rate-limiter.js';
export type {
  RateLimitAlgorithm,
  RateLimitConfig,
  RateLimitResult,
  RateLimitState,
  StorageAdapter,
  TokenBucketConfig,
  SlidingWindowConfig,
  FixedWindowConfig,
} from './types.js';
`;

export const README_MD_TEMPLATE = `# Simple Rate Limiter

A simple, flexible rate limiting library with support for multiple algorithms.

## Features

- ✅ **Token Bucket Algorithm** - Implemented with configurable capacity and refill rate
- ⏳ **Sliding Window Algorithm** - TODO: Not yet implemented
- ⏳ **Fixed Window Algorithm** - TODO: Not yet implemented
- ✅ **In-memory Storage** - Built-in memory adapter for development
- ⏳ **Redis Adapter** - TODO: Persistent storage for production use
- ❌ **Unit Tests** - TODO: No tests yet

## Installation

\`\`\`bash
npm install simple-rate-limiter
\`\`\`

## Quick Start

### Token Bucket

The token bucket algorithm is currently the only implemented algorithm. It allows bursts up to the bucket capacity, with tokens refilling at a constant rate.

\`\`\`typescript
import { RateLimiter } from 'simple-rate-limiter';

// Create a rate limiter: 10 requests per second
const limiter = new RateLimiter({
  algorithm: 'token-bucket',
  capacity: 10,        // Maximum 10 tokens
  refillRate: 10,      // Refill 10 tokens
  refillInterval: 1000 // Every 1000ms (1 second)
});

// Check if request is allowed
const result = await limiter.check('user:123');

if (result.allowed) {
  console.log(\`Request allowed. \${result.remaining} requests remaining.\`);
  // Process the request
} else {
  console.log(\`Rate limit exceeded. Retry after \${result.retryAfter}ms\`);
}

// Or consume tokens in one operation
const consumeResult = await limiter.consume('user:123');
\`\`\`

## API Reference

### \`RateLimiter\`

#### Constructor

\`\`\`typescript
new RateLimiter(config: RateLimitConfig, storage?: StorageAdapter)
\`\`\`

**Parameters:**
- \`config\` - Rate limit configuration (see below)
- \`storage\` - Optional storage adapter (defaults to in-memory)

#### Methods

##### \`check(key: string): Promise<RateLimitResult>\`

Check if a request is allowed without consuming tokens.

**Parameters:**
- \`key\` - Identifier for rate limiting (e.g., user ID, IP address)

**Returns:**
\`\`\`typescript
{
  allowed: boolean;      // Whether the request is allowed
  remaining: number;     // Tokens/requests remaining
  retryAfter?: number;   // Milliseconds until next token (if not allowed)
  limit: number;         // Maximum capacity
}
\`\`\`

##### \`consume(key: string, tokens?: number): Promise<RateLimitResult>\`

Check and consume tokens in a single operation.

**Parameters:**
- \`key\` - Identifier for rate limiting
- \`tokens\` - Number of tokens to consume (default: 1)

**Returns:** Same as \`check()\` but with updated \`remaining\` count

##### \`reset(key: string): Promise<void>\`

Reset the rate limit state for a key.

## Configuration

### Token Bucket

\`\`\`typescript
{
  algorithm: 'token-bucket';
  capacity: number;        // Maximum tokens in bucket
  refillRate: number;      // Tokens added per interval
  refillInterval: number;  // Interval in milliseconds
}
\`\`\`

**Example:** 100 requests per minute
\`\`\`typescript
{
  algorithm: 'token-bucket',
  capacity: 100,
  refillRate: 100,
  refillInterval: 60000  // 60 seconds
}
\`\`\`

### Sliding Window (TODO)

Not yet implemented. Configuration:

\`\`\`typescript
{
  algorithm: 'sliding-window';
  maxRequests: number;   // Maximum requests in window
  windowMs: number;      // Window duration in milliseconds
}
\`\`\`

### Fixed Window (TODO)

Not yet implemented. Configuration:

\`\`\`typescript
{
  algorithm: 'fixed-window';
  maxRequests: number;   // Maximum requests in window
  windowMs: number;      // Window duration in milliseconds
}
\`\`\`

## TODO

This library is partially complete. Outstanding work:

1. **Sliding Window Algorithm**
   - Implement \`checkSlidingWindow()\` method
   - Track request timestamps in state
   - Clean up old timestamps outside the window
   - Calculate remaining capacity

2. **Fixed Window Algorithm**
   - Implement \`checkFixedWindow()\` method
   - Track window start time and request count
   - Reset counter when window expires

3. **Redis Storage Adapter**
   - Implement \`StorageAdapter\` interface with Redis
   - Handle connection management
   - Support key expiration
   - Add connection pooling

4. **Unit Tests**
   - Test token bucket algorithm
   - Test edge cases (burst, sustained load, refill)
   - Test storage adapters
   - Test configuration validation

5. **Documentation**
   - Add more usage examples
   - Document best practices
   - Add architecture decision records
   - Create migration guide from other libraries

## Development

\`\`\`bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Run tests (not yet implemented)
npm test
\`\`\`

## License

MIT
`;

export const GITIGNORE_TEMPLATE = `node_modules/
dist/
*.log
.DS_Store
`;
