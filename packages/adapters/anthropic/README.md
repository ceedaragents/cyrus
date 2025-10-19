# cyrus-adapter-anthropic

Anthropic Claude adapter for the Cyrus IAgentRunner interface.

## Overview

This package provides `AnthropicAgentRunner`, an implementation of the `IAgentRunner` interface that wraps Anthropic's Claude AI through the `ClaudeRunner` class. This adapter allows Cyrus to interact with Claude through a generic interface, enabling potential swapping of AI tools in the future while keeping core logic unchanged.

## Installation

```bash
pnpm add cyrus-adapter-anthropic
```

## Usage

### Basic Example

```typescript
import { AnthropicAgentRunner } from "cyrus-adapter-anthropic";

// Create the adapter
const runner = new AnthropicAgentRunner({
  workingDirectory: "/path/to/project",
  cyrusHome: "~/.cyrus",
  systemPrompt: "You are a helpful coding assistant.",
  modelId: "sonnet",
});

// Initialize
await runner.initialize();

// Register event handlers
runner.onMessage((message) => {
  console.log("Message:", message);
});

runner.onComplete((result) => {
  console.log("Session completed:", result);
});

runner.onError((error) => {
  console.error("Error:", error);
});

// Execute a prompt
const session = await runner.execute({
  content: "Write a hello world function in TypeScript",
});

// Wait for completion
const result = await session.result;
console.log("Final result:", result);

// Cleanup
await runner.cleanup();
```

### Streaming Mode

```typescript
async function* generateMessages() {
  yield {
    role: "user" as const,
    content: { type: "text" as const, text: "Start a task" },
    timestamp: new Date(),
  };

  // Simulate user adding more messages
  await new Promise((resolve) => setTimeout(resolve, 1000));

  yield {
    role: "user" as const,
    content: { type: "text" as const, text: "Continue the task" },
    timestamp: new Date(),
  };
}

const session = await runner.execute({
  content: generateMessages(),
});

// Can also add messages dynamically
session.addMessage("Additional instruction");
```

### Configuration Options

```typescript
interface AgentRunnerConfig {
  // Required
  workingDirectory: string; // Where the agent operates

  // Optional
  cyrusHome?: string; // Home directory for logs (default: ~/.cyrus)
  environment?: Record<string, string>; // Environment variables
  systemPrompt?: string; // System prompt for the agent
  modelId?: string; // Model to use (sonnet, opus, haiku)
  tools?: ToolConfig[]; // Available tools
  [key: string]: unknown; // Additional config passed through
}
```

## Architecture

The adapter follows a clean architecture pattern:

```
AnthropicAgentRunner (IAgentRunner)
         ↓
    translators.ts (type conversion)
         ↓
    ClaudeRunner (Anthropic SDK wrapper)
         ↓
  @anthropic-ai/claude-agent-sdk
```

### Type Translation

The adapter translates between:

- `AgentRunnerConfig` ↔ `ClaudeRunnerConfig`
- `AgentMessage` ↔ `SDKMessage`
- `AgentResult` ↔ `SDKMessage[]`
- `AgentPrompt` ↔ `string | AsyncIterable<SDKUserMessage>`

## API Reference

### AnthropicAgentRunner

#### Methods

- `initialize(): Promise<void>` - Initialize the runner
- `cleanup(): Promise<void>` - Clean up resources
- `execute(prompt: AgentPrompt): Promise<AgentSession>` - Execute a session
- `onMessage(handler: (message: AgentMessage) => void | Promise<void>): void` - Register message handler
- `onComplete(handler: (result: AgentResult) => void | Promise<void>): void` - Register completion handler
- `onError(handler: (error: Error) => void | Promise<void>): void` - Register error handler
- `isRunning(): boolean` - Check if session is running
- `getSessionInfo()` - Get current session metadata

#### Properties

- `config: AgentRunnerConfig` - The configuration (readonly)

### AgentSession

Returned from `execute()`:

```typescript
interface AgentSession {
  id: string; // Session identifier
  messages: AsyncIterable<AgentMessage>; // Stream of messages
  result: Promise<AgentResult>; // Final result
  cancel(): Promise<void>; // Cancel the session
  addMessage(content: string): void; // Add message (streaming mode)
}
```

## Testing

```bash
# Run tests
pnpm test

# Run tests once
pnpm test:run

# Type checking
pnpm typecheck

# Build
pnpm build
```

## Dependencies

- `cyrus-interfaces` - Interface definitions
- `cyrus-claude-runner` - ClaudeRunner implementation
- `@anthropic-ai/claude-agent-sdk` - Anthropic SDK (peer dependency)

## License

MIT
