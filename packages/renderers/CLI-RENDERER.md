# CLI Renderer

An interactive terminal UI renderer for Cyrus agent sessions, providing a Linear activity panel-like experience in the command line.

## Features

- **Real-time Activity Updates**: Stream agent activities as they happen
- **Interactive Message Input**: Send messages to the agent via terminal input
- **Scrollable History**: Navigate through activity history with arrow keys
- **Stop Controls**: Stop sessions with Ctrl+S keyboard shortcut
- **Status Indicators**: Visual indicators for different activity types
- **Markdown-like Formatting**: Clean, readable output with emojis
- **Customizable Icons**: Configure custom status icons

## Installation

```bash
pnpm add @cyrus/renderers
```

## Usage

### Basic Usage

```typescript
import { CLIRenderer } from "@cyrus/renderers/cli";

// Create renderer
const renderer = new CLIRenderer();

// Start a session
await renderer.renderSessionStart({
  id: "session-1",
  issueId: "ISSUE-123",
  issueTitle: "Implement new feature",
  startedAt: new Date(),
});

// Render activities
await renderer.renderActivity("session-1", {
  content: { type: "thought", body: "Analyzing the requirements..." },
});

await renderer.renderActivity("session-1", {
  content: {
    type: "action",
    action: "read_file",
    parameter: '{"path":"src/index.ts"}',
    result: '{"lines":100}',
  },
});

// Complete the session
await renderer.renderComplete("session-1", {
  turns: 5,
  toolsUsed: 3,
  filesModified: ["src/index.ts"],
  exitCode: 0,
});
```

### Custom Configuration

```typescript
const renderer = new CLIRenderer({
  verboseFormatting: true,
  maxActivities: 50,
  statusIcons: {
    thought: "💭",
    action: "🔧",
    response: "💬",
    error: "❌",
    elicitation: "❓",
    prompt: "📝",
    toolUse: "🛠️",
    complete: "✅",
    running: "●",
  },
});
```

### User Input Handling

```typescript
// Get user input stream
const userInput = renderer.getUserInput("session-1");

for await (const input of userInput) {
  if (input.type === "message") {
    console.log("User said:", input.content);
    
    // Process message and respond
    await renderer.renderText("session-1", "Acknowledged!");
  } else if (input.type === "signal") {
    if (input.signal.type === "stop") {
      console.log("User requested stop");
      break;
    }
  }
}
```

## Keyboard Controls

- **Enter**: Send message to agent
- **Ctrl+S**: Stop current session
- **Ctrl+C**: Exit CLI
- **↑/↓**: Scroll through activity history

## Activity Types

The CLI renderer supports all Linear AgentActivity types:

- **thought**: Agent reasoning and planning (💭)
- **action**: Tool/action execution (🔧)
- **response**: Agent responses (💬)
- **error**: Error messages (❌)
- **elicitation**: Requests for user input (❓)
- **prompt**: Prompts for user action (📝)

## Demo

Run the demo script to see the CLI renderer in action:

```bash
cd packages/renderers
pnpm build
node demo-cli-renderer.mjs
```

The demo simulates an agent working on a task with real-time activity updates.

## API Reference

### `CLIRenderer`

#### Constructor Options

```typescript
interface CLIRendererConfig {
  verboseFormatting?: boolean;  // Enable emoji icons (default: true)
  maxActivities?: number;        // Max activities to display (default: 100)
  statusIcons?: Partial<StatusIcons>;  // Custom icons
}
```

#### Methods

- `renderSessionStart(session)`: Start a new session
- `renderActivity(sessionId, activity)`: Render an activity
- `renderText(sessionId, text)`: Render plain text
- `renderToolUse(sessionId, tool, input)`: Render tool usage
- `renderComplete(sessionId, summary)`: Mark session complete
- `renderError(sessionId, error)`: Render an error
- `getUserInput(sessionId)`: Get user input stream
- `start()`: Start the CLI interface
- `stop()`: Stop the CLI interface

## Testing

The CLI renderer includes comprehensive unit tests with >70% coverage:

```bash
pnpm test
pnpm test:coverage
```

## Architecture

The CLI renderer uses:
- **Ink**: React for CLIs - provides component-based UI
- **React**: Component framework
- **chalk**: Terminal colors
- **ink-text-input**: Text input component
- **ink-spinner**: Loading spinners

The renderer implements the `Renderer` interface from `@cyrus/interfaces`, ensuring compatibility with other Cyrus components.

## Limitations

- Requires a terminal that supports ANSI escape codes
- Raw mode must be supported for keyboard input (not available in some CI environments)
- Minimum terminal size: 80x24 characters recommended

## Contributing

When contributing to the CLI renderer:

1. Ensure all tests pass: `pnpm test:run`
2. Maintain >70% test coverage
3. Run type checking: `pnpm typecheck`
4. Build successfully: `pnpm build`
5. Test the demo script works

## License

MIT
