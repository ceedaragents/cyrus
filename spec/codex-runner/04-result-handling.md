# Codex Result Message Handling

## Overview

This document outlines the strategy for extracting final responses from Codex sessions and coercing them into the `SDKResultMessage` format used by Cyrus. Unlike ClaudeRunner which has explicit `result.result` in the SDK, and GeminiRunner which coerces from `lastAssistantMessage`, Codex provides a clean `finalResponse` field in its Turn structure.

## Codex SDK Structure Analysis

### Turn Type (from @openai/codex-sdk v0.63.0)

```typescript
type Turn = {
    items: ThreadItem[];
    finalResponse: string;
    usage: Usage | null;
};
```

### Key Properties

1. **finalResponse**: A `string` field that contains the authoritative final response text from the agent
2. **usage**: Token usage information (may be null)
3. **items**: Array of thread items (commands, file changes, MCP calls, agent messages, etc.)

### Turn Completion Events

```typescript
type TurnCompletedEvent = {
    type: "turn.completed";
    usage: Usage;
};

type TurnFailedEvent = {
    type: "turn.failed";
    error: ThreadError;
};
```

### Usage Type

```typescript
type Usage = {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
};
```

## Result Extraction Strategy

### Primary Source: Turn.finalResponse

The `Turn.finalResponse` field is the authoritative source for the final agent response. Unlike GeminiRunner which must extract text from the last assistant message, Codex provides this directly.

**Key Decision**: Use `Turn.finalResponse` as the primary result source, not individual `AgentMessageItem` items.

### Secondary Source: AgentMessageItem (if needed)

While `finalResponse` should be preferred, the SDK also provides `AgentMessageItem` types:

```typescript
type AgentMessageItem = {
    id: string;
    type: "agent_message";
    text: string;  // Natural-language text or JSON for structured output
};
```

These items appear in the `Turn.items[]` array during streaming but the `finalResponse` is the canonical final output.

## SDKResultMessage Coercion

### Target Structure (from @anthropic-ai/claude-agent-sdk)

```typescript
type SDKResultMessage = {
    type: 'result';
    subtype: 'success';
    duration_ms: number;
    duration_api_ms: number;
    is_error: boolean;
    num_turns: number;
    result: string;
    total_cost_usd: number;
    usage: NonNullableUsage;
    modelUsage: {
        [modelName: string]: ModelUsage;
    };
    permission_denials: SDKPermissionDenial[];
    structured_output?: unknown;
    uuid: UUID;
    session_id: string;
} | {
    type: 'result';
    subtype: 'error_during_execution' | 'error_max_turns' | ...;
    // ... error variant
};
```

### Mapping Strategy

#### Success Case

```typescript
const resultMessage: SDKResultMessage = {
    type: "result",
    subtype: "success",

    // Direct mapping from Turn
    result: turn.finalResponse,

    // Usage mapping
    usage: {
        input_tokens: turn.usage?.input_tokens || 0,
        output_tokens: turn.usage?.output_tokens || 0,
        cache_creation_input_tokens: 0,  // Codex doesn't provide
        cache_read_input_tokens: turn.usage?.cached_input_tokens || 0,
        // ... (see Token/Cost Tracking section)
    },

    // Metadata
    duration_ms: calculatedDuration,
    duration_api_ms: 0,  // Codex doesn't separate API time
    is_error: false,
    num_turns: turnCount,
    total_cost_usd: 0,  // See cost tracking section
    modelUsage: {},  // See model usage section
    permission_denials: [],
    uuid: crypto.randomUUID(),
    session_id: threadId || "pending",
};
```

#### Error Case

Handle `TurnFailedEvent` by mapping to the error variant:

```typescript
const errorMessage: SDKResultMessage = {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: calculatedDuration,
    duration_api_ms: 0,
    is_error: true,
    num_turns: turnCount,
    total_cost_usd: 0,
    usage: /* ... */,
    modelUsage: {},
    permission_denials: [],
    errors: [error.message],
    uuid: crypto.randomUUID(),
    session_id: threadId || "pending",
};
```

## Token/Cost Tracking Approach

### Token Usage

Codex provides straightforward token usage in the `Usage` type:

```typescript
type Usage = {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
};
```

**Mapping to SDKResultMessage.usage**:

```typescript
usage: {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: 0,  // Not provided by Codex
    cache_read_input_tokens: usage.cached_input_tokens,
    cache_creation: {
        ephemeral_1h_input_tokens: 0,  // Not provided
        ephemeral_5m_input_tokens: 0,  // Not provided
    },
    server_tool_use: {
        web_fetch_requests: 0,  // Could track from WebSearchItem count
        web_search_requests: 0,  // Could track from WebSearchItem count
    },
    service_tier: "standard" as const,
}
```

### Cost Calculation

**Current Limitation**: The Codex SDK does not provide cost information directly.

**Options**:
1. **Set to 0** (like GeminiRunner) - simplest approach
2. **Calculate from token usage** - requires OpenAI pricing data for the model used
3. **Track from OpenAI API headers** - may not be available via CLI

**Recommendation**: Start with `total_cost_usd: 0` and enhance later if cost data becomes available.

### Model Usage Tracking

The `modelUsage` field tracks per-model usage. For Codex:

```typescript
modelUsage: {
    [model]: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: usage.cached_input_tokens,
        cacheCreationInputTokens: 0,
        webSearchRequests: webSearchCount,
        costUSD: 0,  // See cost calculation above
        contextWindow: 0,  // Could be inferred from model name
    }
}
```

The model name should be tracked from `ThreadOptions.model` or detected from the Codex configuration.

## Multi-Turn Session Handling

### Turn Count Tracking

Each call to `thread.run()` or `thread.runStreamed()` represents one turn. The runner should:

1. Track a `turnCount` that increments with each turn
2. Map this to `SDKResultMessage.num_turns`

### Session Continuity

The `thread.id` provides session continuity:

```typescript
type Thread = {
    get id(): string | null;  // Populated after first turn
    run(input: Input, turnOptions?: TurnOptions): Promise<Turn>;
    runStreamed(input: Input, turnOptions?: TurnOptions): Promise<StreamedTurn>;
};
```

**Strategy**:
- Use `thread.id` for `SDKResultMessage.session_id`
- Initially null, populated after first turn starts
- Use "pending" as fallback like GeminiRunner

## Structured Output Support

Codex supports structured output via `outputSchema`:

```typescript
type TurnOptions = {
    outputSchema?: unknown;  // JSON schema
    signal?: AbortSignal;
};

type SDKResultMessage = {
    // ...
    structured_output?: unknown;
};
```

**Mapping**: If `TurnOptions.outputSchema` was provided, parse `Turn.finalResponse` as JSON and include in `structured_output` field.

## Comparison with Other Runners

### ClaudeRunner
- **Source**: Explicit `SDKResultMessage` from SDK
- **Result field**: Directly available as `result.result`
- **Token/Cost**: Comprehensive from SDK

### GeminiRunner
- **Source**: Coerces from `lastAssistantMessage.message.content`
- **Result field**: Extracts text from content blocks
- **Token/Cost**: Stats object with limited data

### CodexRunner (proposed)
- **Source**: Direct `Turn.finalResponse` field
- **Result field**: Clean string, no extraction needed
- **Token/Cost**: Basic token usage, no cost info

**Advantage**: Codex provides the cleanest result extraction - no need to parse content blocks or iterate through items.

## Implementation Checklist

- [ ] Extract result from `Turn.finalResponse`
- [ ] Map `Usage` to `SDKResultMessage.usage` format
- [ ] Handle null usage case
- [ ] Track turn count across session
- [ ] Use `thread.id` for session_id
- [ ] Set cost fields to 0 initially
- [ ] Handle `TurnFailedEvent` errors
- [ ] Support structured output if `outputSchema` provided
- [ ] Track model usage per model
- [ ] Count web search requests from `WebSearchItem` items

## References

- Codex SDK types: `node_modules/@openai/codex-sdk/dist/index.d.ts`
- Claude SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- GeminiRunner implementation: `packages/gemini-runner/src/adapters.ts:189-238`
- ClaudeRunner types: `packages/claude-runner/src/types.ts`
