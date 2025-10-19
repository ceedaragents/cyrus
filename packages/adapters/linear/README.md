# cyrus-adapter-linear

Linear-specific implementation of `IUserInterface` for Cyrus. This adapter translates between Linear's API/webhooks and Cyrus's abstract WorkItem/Activity model, hiding all Linear-specific details behind a clean interface.

## Overview

The `LinearAdapter` class implements the `IUserInterface` contract from `cyrus-interfaces`, providing:

- **Webhook Translation**: Converts Linear webhooks (issue assignments, comments, agent sessions) into `WorkItem` objects
- **Activity Posting**: Translates Cyrus `Activity` objects into Linear agent activities
- **Issue Management**: Provides methods to fetch and update Linear issues through the abstract interface
- **Session Mapping**: Automatically tracks the relationship between WorkItems and Linear agent sessions

## Installation

```bash
pnpm add cyrus-adapter-linear
```

## Usage

### Basic Setup

```typescript
import { LinearClient } from '@linear/sdk';
import { LinearWebhookClient } from 'cyrus-linear-webhook-client';
import { LinearAdapter } from 'cyrus-adapter-linear';

// Create Linear client
const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY,
});

// Create webhook client
const webhookClient = new LinearWebhookClient({
  proxyUrl: 'https://your-proxy.com',
  token: process.env.LINEAR_TOKEN,
  transport: 'webhook',
  webhookPort: 3000,
  webhookPath: '/webhooks/linear',
});

// Create adapter
const adapter = new LinearAdapter({
  linearClient,
  webhookClient,
  logger: console, // Optional custom logger
});

// Initialize
await adapter.initialize();

// Register work item handler
adapter.onWorkItem(async (workItem) => {
  console.log('Received work item:', workItem.title);
  console.log('Type:', workItem.type); // 'task', 'command', or 'conversation'
  console.log('Description:', workItem.description);
});

// Post activities back to Linear
await adapter.postActivity({
  id: 'activity-1',
  workItemId: 'work-item-id',
  timestamp: new Date(),
  type: 'thought',
  content: {
    type: 'text',
    text: 'Starting work on this issue...',
  },
});

// Update work item status
await adapter.updateWorkItem('work-item-id', {
  status: 'active',
  message: 'Work in progress',
});

// Cleanup
await adapter.shutdown();
```

## Webhook Types Handled

The adapter translates these Linear webhook types to WorkItems:

| Linear Webhook | WorkItem Type | Description |
|----------------|---------------|-------------|
| `issueAssignedToYou` | `task` | Issue assigned to Cyrus |
| `issueCommentMention` | `command` | Cyrus mentioned in a comment |
| `issueNewComment` | `conversation` | New comment on assigned issue |
| `AgentSessionEvent` (created) | `conversation` | New agent session created |
| `AgentSessionEvent` (prompted) | `conversation` | User feedback on agent session |

## Activity Translation

Cyrus activities are mapped to Linear agent activity types:

| Cyrus Activity Type | Linear Activity Type | Notes |
|---------------------|---------------------|-------|
| `thought` | `thought` | Internal reasoning |
| `action` | `action` | Tool execution |
| `result` | `response` | Tool results |
| `error` | `error` | Error messages |

## API

### `LinearAdapter`

#### Constructor

```typescript
new LinearAdapter(config: LinearAdapterConfig)
```

**Config Options:**
- `linearClient`: LinearClient instance
- `webhookClient`: LinearWebhookClient instance
- `logger`: Optional logger (defaults to console)

#### Methods

**`initialize(): Promise<void>`**
Sets up webhook listeners and connects to Linear. Must be called before use.

**`shutdown(): Promise<void>`**
Disconnects webhook client and cleans up resources.

**`onWorkItem(handler: (item: WorkItem) => void | Promise<void>): void`**
Registers a callback for incoming work items from Linear webhooks.

**`postActivity(activity: Activity): Promise<void>`**
Posts a Cyrus activity to Linear as an agent activity.

**`updateWorkItem(id: string, update: WorkItemUpdate): Promise<void>`**
Updates a Linear issue's status or adds a comment.

**`getWorkItem(id: string): Promise<WorkItem>`**
Fetches a Linear issue and converts it to a WorkItem.

**`getWorkItemHistory(id: string): Promise<Activity[]>`**
Retrieves all agent activities for a work item's session.

## Architecture

```
Linear Webhook → LinearAdapter → WorkItem → Your Code
                      ↑                          ↓
                      └──────── Activity ────────┘
```

The adapter maintains an internal mapping between WorkItem IDs and Linear agent session IDs, ensuring activities are posted to the correct session.

## Error Handling

The adapter throws errors in these cases:
- Not initialized before use
- Agent session not found for a work item
- Linear API errors
- Invalid work item IDs

Always wrap adapter calls in try-catch blocks and handle errors appropriately.

## Testing

Run tests:
```bash
pnpm test
```

Run tests with coverage:
```bash
pnpm test:coverage
```

## License

ISC
