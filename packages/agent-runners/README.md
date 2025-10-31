# @cyrus/agent-runners

Adapters for various agent runners to implement the AgentRunner interface from `@cyrus/interfaces`.

## Overview

This package provides adapter implementations that wrap existing agent runners (like ClaudeRunner) to conform to the standardized `AgentRunner` interface. This allows different agent implementations to be used interchangeably throughout the Cyrus system.

## Installation

```bash
pnpm add @cyrus/agent-runners
```

## Usage

### ClaudeAgentRunner

The `ClaudeAgentRunner` wraps the existing `ClaudeRunner` to implement the `AgentRunner` interface:

```typescript
import { ClaudeAgentRunner } from '@cyrus/agent-runners/claude';

const runner = new ClaudeAgentRunner({
  cyrusHome: '/path/to/.cyrus',
  workingDirectory: '/path/to/project',
});

// Start a session
const session = await runner.start({
  workingDirectory: '/path/to/project',
  prompt: 'Implement feature X',
  systemPrompt: 'You are a helpful coding assistant',
  maxTurns: 10,
});

// Listen to events
for await (const event of session.events) {
  switch (event.type) {
    case 'text':
      console.log('Agent output:', event.text);
      break;
    case 'tool-use':
      console.log('Tool used:', event.toolName);
      break;
    case 'complete':
      console.log('Session complete:', event.summary);
      break;
    case 'error':
      console.error('Error:', event.error);
      break;
  }
}

// Send additional messages
await runner.sendMessage(session.id, 'Please add tests');

// Stop the session
await runner.stop(session.id);
```

### Streaming Prompts

The adapter supports streaming prompts via async iterables:

```typescript
async function* generatePrompts() {
  yield { role: 'user', content: 'Start with task 1' };
  await someAsyncOperation();
  yield { role: 'user', content: 'Now do task 2' };
}

const session = await runner.start({
  workingDirectory: '/path/to/project',
  prompt: generatePrompts(),
});
```

### Resume Sessions

You can resume existing Claude sessions:

```typescript
const session = await runner.resume('session-id-123', {
  workingDirectory: '/path/to/project',
  prompt: 'Continue where we left off',
});
```

## Architecture

The `ClaudeAgentRunner` is a thin adapter that:

1. **Wraps ClaudeRunner**: Maintains a reference to the underlying ClaudeRunner instance
2. **Maps Events**: Converts ClaudeRunner events to AgentEvent types
3. **Manages Sessions**: Tracks session IDs and provides session lifecycle methods
4. **Preserves Compatibility**: Does not modify ClaudeRunner, ensuring backward compatibility

### Event Mapping

| ClaudeRunner Event | AgentEvent Type |
|-------------------|-----------------|
| `text` | `TextEvent` |
| `tool-use` | `ToolUseEvent` |
| `message` (tool_result) | `ToolResultEvent` |
| `error` | `ErrorEvent` |
| `complete` | `CompleteEvent` |

## API

### Constructor

```typescript
new ClaudeAgentRunner(defaultConfig: Partial<ClaudeRunnerConfig>)
```

Creates a new adapter with default configuration that will be merged with per-session configs.

### Methods

#### `start(config: AgentSessionConfig): Promise<AgentSession>`

Starts a new agent session with the given configuration.

#### `sendMessage(sessionId: string, message: string): Promise<void>`

Sends an additional message to an active streaming session.

#### `stop(sessionId: string): Promise<void>`

Stops a running session.

#### `resume(sessionId: string, config: AgentSessionConfig): Promise<AgentSession>`

Resumes an existing Claude session with a new prompt.

#### `isRunning(sessionId: string): boolean`

Checks if a session is currently running.

#### `getEventStream(sessionId: string): AsyncIterable<AgentEvent>`

Gets the event stream for a session.

## Testing

Run tests:

```bash
pnpm test:run
```

Run tests with coverage:

```bash
pnpm test:coverage
```

## License

MIT
