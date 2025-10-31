# @cyrus/issue-trackers

Issue tracker adapters for Cyrus that implement the `IssueTracker` interface from `@cyrus/interfaces`.

## Features

- **Linear Adapter** - Complete implementation for Linear issue tracking
- **Type-Safe** - Full TypeScript support with type mapping
- **Event Streaming** - Real-time issue updates via webhooks
- **Agent Signals** - Support for start, stop, and feedback signals
- **Attachment Support** - Download and manage issue attachments

## Installation

```bash
pnpm add @cyrus/issue-trackers
```

## Usage

### Linear Issue Tracker

```typescript
import { LinearIssueTracker } from "@cyrus/issue-trackers";

// Initialize the tracker
const tracker = new LinearIssueTracker({
  accessToken: process.env.LINEAR_API_TOKEN!,
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
});

// Get an issue
const issue = await tracker.getIssue("CYPACK-268");
console.log(issue.title, issue.state.type);

// List assigned issues
const issues = await tracker.listAssignedIssues(memberId, {
  state: ["started", "unstarted"],
  limit: 10,
});

// Add a comment
const commentId = await tracker.addComment(issue.id, {
  author: { id: "bot-id", name: "Bot" },
  content: "Working on this issue...",
  createdAt: new Date(),
  isRoot: true,
});

// Update issue state
await tracker.updateIssueState(issue.id, {
  type: "completed",
  name: "Done",
});

// Watch for updates
for await (const event of tracker.watchIssues(memberId)) {
  switch (event.type) {
    case "assigned":
      console.log("New assignment:", event.issue.identifier);
      break;
    case "comment-added":
      console.log("New comment:", event.comment.content);
      break;
    case "state-changed":
      console.log("State changed:", event.oldState.type, "→", event.newState.type);
      break;
  }
}
```

### Webhook Integration

The `watchIssues()` method returns an async iterable that relies on webhook events being fed into the tracker:

```typescript
import { LinearIssueTracker } from "@cyrus/issue-trackers";
import type { IssueEvent } from "@cyrus/interfaces";

const tracker = new LinearIssueTracker({ accessToken: "..." });

// When you receive a webhook from Linear, convert it to an IssueEvent
// and emit it to the tracker
app.post("/webhooks/linear", async (req, res) => {
  const webhookPayload = req.body;

  // Convert webhook to IssueEvent (implementation depends on webhook type)
  const event: IssueEvent = convertWebhookToEvent(webhookPayload);

  // Emit to all watchers
  tracker.emitWebhookEvent(event);

  res.json({ success: true });
});
```

## API Reference

### LinearIssueTracker

Implements the `IssueTracker` interface with Linear SDK integration.

#### Constructor

```typescript
new LinearIssueTracker(config: LinearIssueTrackerConfig)
```

**Config Options:**
- `accessToken: string` - Linear API access token (required)
- `webhookSecret?: string` - Webhook secret for signature verification

#### Methods

All methods from the `IssueTracker` interface:

- `getIssue(issueId: string): Promise<Issue>`
- `listAssignedIssues(memberId: string, filters?: IssueFilters): Promise<Issue[]>`
- `updateIssueState(issueId: string, state: IssueState): Promise<void>`
- `addComment(issueId: string, comment: Comment): Promise<string>`
- `getComments(issueId: string): Promise<Comment[]>`
- `watchIssues(memberId: string): AsyncIterable<IssueEvent>`
- `getAttachments(issueId: string): Promise<Attachment[]>`
- `sendSignal(issueId: string, signal: AgentSignal): Promise<void>`

Additional methods:

- `emitWebhookEvent(event: IssueEvent): void` - Feed webhook events to watchers
- `stopWatchers(): void` - Stop all active watchers

## Type Mappings

The adapter automatically maps Linear types to abstract types:

- `LinearWorkflowState` → `IssueState`
- `LinearUser` → `Member`
- `LinearLabel` → `Label`
- `LinearIssue` → `Issue`
- `LinearComment` → `Comment`
- `LinearAttachment` → `Attachment`

## Testing

The package includes comprehensive unit tests with >80% coverage:

```bash
# Run tests
pnpm test

# Run tests once
pnpm test:run

# Generate coverage report
pnpm test:coverage
```

## Architecture

```
packages/issue-trackers/
├── src/
│   ├── linear/
│   │   ├── LinearIssueTracker.ts  # Main adapter implementation
│   │   ├── mappers.ts             # Type mapping utilities
│   │   └── index.ts               # Linear module exports
│   └── index.ts                   # Package exports
└── test/
    └── linear/
        ├── LinearIssueTracker.test.ts
        └── mappers.test.ts
```

## License

MIT
