# Failing Test: agentContextId Deprecation Issue

## Problem Summary

The Linear API has deprecated the `agentContextId` field in `AgentActivity` webhooks, but our TypeScript types in `packages/core/src/webhook-types.ts` still require this field. This causes type checking failures when processing webhooks from Linear.

## Test Files Created

1. **test/webhook-types-agentContext.test.ts** - Demonstrates TypeScript type errors
2. **test/webhook-types-strict.test.ts** - Shows strict type checking failures
3. **test/AgentSessionManager.webhook-types.test.ts** - Shows impact on AgentSessionManager
4. **test/webhook-agentContext-runtime.test.ts** - Demonstrates runtime behavior

## TypeScript Errors

When running `npx tsc --noEmit` on these test files:

```
test/webhook-types-agentContext.test.ts(27,9): error TS2741: Property 'agentContextId' is missing in type '{ id: string; createdAt: string; updatedAt: string; archivedAt: any; agentSessionId: string; sourceCommentId: string; content: { type: "thought"; body: string; }; }' but required in type 'LinearWebhookAgentActivity'.
```

## The Issue

In `packages/core/src/webhook-types.ts` line 233:

```typescript
export interface LinearWebhookAgentActivity {
    id: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    agentContextId: string | null;  // <-- This field is no longer sent by Linear
    agentSessionId: string;
    sourceCommentId: string;
    content: LinearWebhookAgentActivityContent;
}
```

## The Fix

Change `agentContextId` to be optional:

```typescript
agentContextId?: string | null;  // Make it optional with ?
```

## Impact

- TypeScript compilation fails when trying to parse actual Linear webhooks
- Runtime code that expects `agentContextId` to be `string | null` will encounter `undefined` instead
- Any code handling Linear webhooks needs to account for the missing field

## Running the Tests

```bash
# Run the runtime tests (they pass but show the issue)
pnpm test webhook-agentContext-runtime.test.ts

# Check TypeScript errors
npx tsc --noEmit test/webhook-types-agentContext.test.ts
```