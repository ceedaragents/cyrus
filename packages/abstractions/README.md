# @cyrus/abstractions

Core abstractions and interfaces for the Cyrus I/O system.

## Overview

This package defines platform-agnostic interfaces that enable pluggable, testable, and maintainable I/O components for Cyrus. All inputs, outputs, and processing components implement these interfaces.

## Core Concepts

### Agent Runner (`IAgentRunner`)

Abstract interface for any CLI-based agent tool (Claude Code, GPT Engineer, Devin, etc.).

```typescript
import { IAgentRunner } from '@cyrus/abstractions';

const runner: IAgentRunner = ...; // implementation
runner.on('assistant', (text) => console.log(text));
await runner.start('Please help me fix this bug');
```

**Key Features:**
- Platform-agnostic message format
- Event-driven communication
- Streaming support
- Session management

### Input Source (`IInputSource`)

Abstract interface for input sources that generate events (webhooks, HTTP, CLI, etc.).

```typescript
import { IInputSource } from '@cyrus/abstractions';

const source: IInputSource = ...; // implementation
source.on('event', async (event) => {
  console.log('Received:', event);
  await source.sendStatus({
    eventId: event.id,
    status: 'processing'
  });
});
await source.connect();
```

**Key Features:**
- Generic event structure
- Connection lifecycle management
- Status reporting back to source
- Error handling

### Output Renderer (`IOutputRenderer`)

Abstract interface for rendering agent output to different targets (Linear, CLI, Slack, etc.).

```typescript
import { IOutputRenderer } from '@cyrus/abstractions';

const renderer: IOutputRenderer = ...; // implementation
await renderer.initialize();

const session = await renderer.createSession({
  taskId: 'PROJ-123',
  title: 'Fix login bug'
});

await session.writeMessage({
  type: 'assistant',
  content: 'Starting work...',
  timestamp: new Date()
});

await session.writeActivity({
  type: 'tool-use',
  description: 'Reading authentication code',
  timestamp: new Date()
});
```

**Key Features:**
- Session-based rendering
- Capability system (what the renderer can do)
- Activity tracking (like Linear's agent activities)
- Interactive input support (optional)

### Orchestrator (`IOrchestrator`)

Coordinates inputs, processing, and outputs.

```typescript
import { IOrchestrator } from '@cyrus/abstractions';

const orchestrator: IOrchestrator = ...; // implementation

// Register components
orchestrator.addInputSource('webhooks', webhookSource);
orchestrator.addOutputRenderer('linear', linearRenderer);
orchestrator.addOutputRenderer('cli', cliRenderer);
orchestrator.setAgentRunnerFactory(factory);

// Configure routing
orchestrator.setRoutingConfig({
  defaultRenderer: 'cli',
  routes: [
    { eventType: 'linear:*', renderer: 'linear' }
  ]
});

// Start
await orchestrator.start();
```

**Key Features:**
- Pluggable components
- Event routing
- Lifecycle management
- Error handling

## Architecture

```
┌─────────────┐
│Input Sources│
│  (Webhooks, │
│   HTTP, CLI)│
└──────┬──────┘
       │ Events
       ▼
┌─────────────┐
│Orchestrator │ ◄── Routes events to appropriate renderer
└──────┬──────┘
       │ Creates
       ▼
┌─────────────┐
│AgentRunner  │ ◄── Processes events using AI agent
└──────┬──────┘
       │ Messages/Activities
       ▼
┌─────────────┐
│   Renderer  │ ◄── Displays output (Linear, CLI, etc.)
└─────────────┘
```

## Interface Hierarchy

```
Agent:
  ├── IAgentMessage       # Individual message
  ├── IAgentSession       # Session state
  └── IAgentRunner        # Agent execution

Input:
  ├── IInputEvent         # Event structure
  ├── IStatusUpdate       # Processing status
  └── IInputSource<T>     # Event source

Output:
  ├── ISessionContext     # Session initialization
  ├── IRendererMessage    # Message to display
  ├── IRendererActivity   # Activity tracking
  ├── IRendererStatus     # Status updates
  ├── IRendererSession    # Session-specific rendering
  └── IOutputRenderer     # Renderer management

Orchestration:
  ├── IAgentRunnerConfig  # Agent configuration
  ├── IAgentRunnerFactory # Agent creation
  ├── IRoutingConfig      # Event routing
  └── IOrchestrator       # Main coordinator
```

## Design Principles

1. **Platform-Agnostic**: Interfaces work with any implementation
2. **Event-Driven**: Async communication via events
3. **Testable**: Easy to mock and test components
4. **Composable**: Mix and match implementations
5. **Type-Safe**: Full TypeScript typing

## Type Guards

All interfaces include type guards for runtime type checking:

```typescript
import { isAgentRunner, isInputSource, isOutputRenderer } from '@cyrus/abstractions';

if (isAgentRunner(obj)) {
  // TypeScript knows obj is IAgentRunner
  await obj.start('prompt');
}
```

## Example Implementations

See these packages for concrete implementations:

- `@cyrus/claude-agent-runner` - Claude Code implementation of `IAgentRunner`
- `@cyrus/linear-input` - Linear webhooks implementation of `IInputSource`
- `@cyrus/linear-renderer` - Linear API implementation of `IOutputRenderer`
- `@cyrus/cli-renderer` - Terminal UI implementation of `IOutputRenderer`
- `@cyrus/orchestrator` - Default orchestrator implementation

## Testing

All interfaces are designed to be easily mockable:

```typescript
import { IAgentRunner } from '@cyrus/abstractions';

class MockAgentRunner implements IAgentRunner {
  async start(prompt: string) {
    return {
      sessionId: 'mock-123',
      startedAt: new Date(),
      isRunning: true
    };
  }
  // ... implement other methods
}

const runner = new MockAgentRunner();
// Use in tests
```

## License

MIT
