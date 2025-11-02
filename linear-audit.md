# Linear Integration Audit - Comprehensive Catalog

**Generated:** 2025-11-01
**Purpose:** Exhaustive catalog of all Linear SDK calls and MCP tools to inform abstraction layer design for CYPACK-306

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [@linear/sdk Direct Usage](#linearsdk-direct-usage)
3. [MCP Linear Tools](#mcp-linear-tools)
4. [MCP Cyrus Tools (Linear Integration)](#mcp-cyrus-tools-linear-integration)
5. [Linear Webhook Types](#linear-webhook-types)
6. [Linear-Specific Types](#linear-specific-types)
7. [Abstraction Requirements](#abstraction-requirements)

---

## Executive Summary

### Statistics
- **@linear/sdk imports**: 33 files
- **LinearClient method calls**: 31 distinct usage sites
- **MCP tool references**: 2 files (orchestrator.md, test scripts)
- **Cyrus custom MCP tools**: 5 tools
- **Webhook payload types**: 6 types + 6 type guards
- **Linear-specific types**: 15+ interfaces/types requiring abstraction

### Operation Categories
- **Read Operations**: `issue()`, `comment()`, `comments()`, `teams()`, `issueLabels()`, `workflowStates()`, state/assignee/team property access
- **Write Operations**: `createAgentActivity()`, `createComment()`, `updateIssue()`, `fileUpload()`
- **Raw GraphQL**: Agent session creation mutations via `client.rawRequest()`

---

## @linear/sdk Direct Usage

### Package: `packages/linear-event-transport`

#### File: `src/types.ts`
```typescript
Location: packages/linear-event-transport/src/types.ts

Line 5: import type { LinearWebhookPayload } from "@linear/sdk/webhooks";

Usage: Type import for webhook payload type used in event transport configuration
Operation Type: Read (Type only)
```

#### File: `src/LinearEventTransport.ts`
```typescript
Location: packages/linear-event-transport/src/LinearEventTransport.ts

Lines 2-5:
import {
	LinearWebhookClient,
	type LinearWebhookPayload,
} from "@linear/sdk/webhooks";

Usage: Webhook verification client and payload types
Operation Type: Read (Webhook verification)

Key Methods:
- Line 33: new LinearWebhookClient(config.secret)
- Line 41: this.linearWebhookClient = new LinearWebhookClient(config.secret)
- Line 94: this.linearWebhookClient.verify(bodyBuffer, signature)
- Line 102: this.emit("webhook", request.body as LinearWebhookPayload)
```

### Package: `packages/core`

#### File: `src/webhook-types.ts`
```typescript
Location: packages/core/src/webhook-types.ts

Line 6: import type { LinearDocument } from "@linear/sdk";

Usage: Import Linear SDK types for webhook payloads
Operation Type: Read (Type only)

Type Re-exports:
- Line 192-193: LinearWebhookGuidanceRule = LinearDocument.GuidanceRuleWebhookPayload
- Line 194-195: LinearWebhookOrganizationOrigin = LinearDocument.OrganizationOriginWebhookPayload
- Line 196: LinearWebhookTeamOrigin = LinearDocument.TeamOriginWebhookPayload
- Line 197-198: LinearWebhookTeamWithParent = LinearDocument.TeamWithParentWebhookPayload
- Line 212: status: "pending" | "active" | "error" | "awaiting-input" | "complete" (uses Linear status enum)
- Line 215: type: "commentThread" (uses Linear session type)

Type Guards (Lines 300-334):
- isIssueAssignedWebhook()
- isIssueCommentMentionWebhook()
- isIssueNewCommentWebhook()
- isIssueUnassignedWebhook()
- isAgentSessionCreatedWebhook()
- isAgentSessionPromptedWebhook()
```

#### File: `src/CyrusAgentSession.ts`
```typescript
Location: packages/core/src/CyrusAgentSession.ts

Line 1: import { LinearDocument } from "@linear/sdk";

Usage: Linear session status and type enums
Operation Type: Read (Type only)

Key Usage:
- Line 88: status: LinearDocument.AgentSessionStatus.Active
- Line 89: context: LinearDocument.AgentSessionType.CommentThread
- Line 239: status: LinearDocument.AgentSessionStatus.Complete | Error
```

### Package: `packages/edge-worker`

#### File: `src/EdgeWorker.ts`
```typescript
Location: packages/edge-worker/src/EdgeWorker.ts

Lines 5-9:
import {
	type Comment,
	LinearClient,
	type Issue as LinearIssue,
} from "@linear/sdk";

Usage: Main Linear SDK integration for EdgeWorker orchestration
Operation Type: Read & Write

LinearClient Instantiation:
- Line 166-168: new LinearClient({ accessToken: repo.linearToken })
- Stored in Map<string, LinearClient> keyed by repository ID

LinearClient Method Calls:

1. **createAgentActivity()** (Write) - 15 occurrences
   - Line 483: Post child result receipt thought to parent session
   - Line 883: Post timeout error to agent session
   - Line 1080: Post action activity (AgentSessionManager)
   - Line 1134: Post elicitation activity (AgentSessionManager)
   - Line 1170: Post error activity (AgentSessionManager)
   - Line 1209: Post observation activity (AgentSessionManager)
   - Line 1251: Post response activity (AgentSessionManager)
   - Line 1294: Post thought activity (AgentSessionManager)
   - Line 1411: Post approval elicitation (AgentSessionManager)
   - Line 1444: Post approval thought (AgentSessionManager)
   - Line 1484: Post error activity (AgentSessionManager)
   - Line 3378: Post timeout notification
   - Line 4229: Post parent resume acknowledgment
   - Line 4272: Post parent feedback delivery notification
   - Line 4517: Post procedure completion activity
   - Line 4703: Post procedure routing thought

2. **issue()** (Read) - 4 occurrences
   - Line 1060: Fetch issue to check if it needs state transition to "started"
   - Line 1651: Fetch full issue data for prompt assembly
   - Line 4739: Fetch full issue when processing new comment webhook

3. **client.rawRequest()** (Raw GraphQL) - 1 occurrence
   - Line 1700: Fetch comment with attachments using raw GraphQL query

4. **teams()** (Read) - 1 occurrence
   - Line 2041: Fetch all teams for repository routing

5. **issueLabels()** (Read) - 1 occurrence
   - Line 2060: Fetch all issue labels for label-based routing

6. **comments()** (Read) - 2 occurrences
   - Line 2486: Fetch comments for an issue with pagination
   - Line 2888: Fetch comments to build attachment manifest

7. **comment()** (Read) - 1 occurrence
   - Line 2548: Fetch full comment data by ID

8. **workflowStates()** (Read) - 1 occurrence
   - Line 2706: Query workflow states to find "started" state for issue

9. **updateIssue()** (Write) - 1 occurrence
   - Line 2739: Update issue state to "started" when assigned

10. **createComment()** (Write) - 1 occurrence (commented out reference at Line 2769)
    - Line 2794: Create comment on issue

Property Access on Linear Objects:
- Line 2011-2014: issue.assigneeId, issue.assignee (async property)
- Line 2349: comment.parent (async property)
- Line 2353: comment.id
- Line 2359: comment.parent (async property)
- Line 2471: issue.state (async property)
- Line 2593: issue.state (async property)
- Line 2688: issue.state (async property)
- Line 2697: issue.team (async property)
- Line 2893: comment.body
- Line 1725: comment.user, comment.createdAt
- Line 1728: comment.createdAt
- Line 1739: comment.body
```

#### File: `src/AgentSessionManager.ts`
```typescript
Location: packages/edge-worker/src/AgentSessionManager.ts

Line 1: import { type LinearClient, LinearDocument } from "@linear/sdk";

Usage: Agent session management with Linear integration
Operation Type: Read & Write

Key Usage:
- Line 31: private linearClient: LinearClient
- Line 49-62: Constructor accepts LinearClient instance
- Line 87: LinearDocument.AgentSessionType.CommentThread
- Line 88: LinearDocument.AgentSessionStatus.Active

LinearClient Method Calls (via this.linearClient):
- Line 932: createAgentActivity() - Post action activity
- Line 1080: createAgentActivity() - Post elicitation activity
- Line 1134: createAgentActivity() - Post error activity
- Line 1170: createAgentActivity() - Post observation activity
- Line 1209: createAgentActivity() - Post response activity
- Line 1251: createAgentActivity() - Post thought activity
- Line 1294: createAgentActivity() - Post tool use activity
- Line 1411: createAgentActivity() - Post approval elicitation
- Line 1444: createAgentActivity() - Post approval thought
- Line 1484: createAgentActivity() - Post error on approval failure
```

### Package: `packages/claude-runner`

#### File: `src/tools/cyrus-tools/index.ts`
```typescript
Location: packages/claude-runner/src/tools/cyrus-tools/index.ts

Line 4: import { LinearClient } from "@linear/sdk";

Usage: Custom MCP tools for Linear integration
Operation Type: Read & Write

LinearClient Instantiation:
- Line 102: new LinearClient({ apiKey: linearApiToken })

LinearClient Method Calls:

1. **fileUpload()** (Write) - 1 occurrence
   - Line 158: Upload file to Linear cloud storage
   - Parameters: contentType, filename, size, { makePublic }
   - Returns: { uploadUrl, headers, assetUrl }

2. **Raw GraphQL Mutations** - 2 occurrences
   - Lines 270-295: agentSessionCreateOnIssue mutation
     - Accesses: (linearClient as any).client.rawRequest()
     - Creates agent session on an issue
   - Lines 370-395: agentSessionCreateOnComment mutation
     - Accesses: (linearClient as any).client.rawRequest()
     - Creates agent session on a root comment

3. **issue()** (Read) - 1 occurrence
   - Line 572: Fetch parent issue for children query

4. **Issue Property Access**:
   - Line 600: issue.children() - Fetch child issues with filter
   - Line 606: childrenConnection.nodes - Get child issue nodes
   - Lines 611-614: child.state, child.assignee (async properties)
   - Line 617-630: Extract child issue properties (id, identifier, title, state, assignee, priority, etc.)
```

### Package: `apps/cli`

#### File: `src/services/WorkerService.ts`
```typescript
Location: apps/cli/src/services/WorkerService.ts

Usage: No direct LinearClient usage, but imports Linear types from cyrus-core
Operation Type: Type imports only
```

#### File: `src/services/GitService.ts`
```typescript
Location: apps/cli/src/services/GitService.ts

Usage: No direct LinearClient usage
```

---

## MCP Linear Tools

These are references to the official Linear MCP server tools in documentation and orchestrator prompts.

### File: `packages/edge-worker/prompts/orchestrator.md`

```markdown
Location: packages/edge-worker/prompts/orchestrator.md

Lines 14-16: Linear MCP Tools Section
- `mcp__linear__linear_createIssue` - Create sub-issues with proper context
  * CRITICAL: ALWAYS INCLUDE `parentId` PARAMETER AND `assigneeId` PARAMETER
- `mcp__linear__linear_getIssueById` - Retrieve issue details

Usage Context: Orchestrator agent uses these tools to decompose parent issues into sub-issues
Operation Type: Write (createIssue), Read (getIssueById)
```

### File: `packages/claude-runner/test-scripts/simple-claude-runner-test.js`

```javascript
Location: packages/claude-runner/test-scripts/simple-claude-runner-test.js

Usage: Test script for Linear MCP integration
Note: This is a test/demo script, not production code
```

---

## MCP Cyrus Tools (Linear Integration)

Custom MCP tools built on top of @linear/sdk, providing Cyrus-specific functionality.

### Tool: `linear_upload_file`

```typescript
Location: packages/claude-runner/src/tools/cyrus-tools/index.ts:105-250

Description: Upload a file to Linear cloud storage and get an asset URL

Parameters:
- filePath: string (required) - Absolute path to file
- filename: string (optional) - Filename to use in Linear
- contentType: string (optional) - MIME type (auto-detected if not provided)
- makePublic: boolean (optional) - Make file publicly accessible (default: false)

Linear SDK Methods Used:
- linearClient.fileUpload(contentType, filename, size, { makePublic })

Returns:
- success: boolean
- assetUrl: string (URL to use in issue descriptions/comments)
- filename: string
- size: number
- contentType: string

Operation Type: Write
```

### Tool: `linear_agent_session_create`

```typescript
Location: packages/claude-runner/src/tools/cyrus-tools/index.ts:252-350

Description: Create an agent session on a Linear issue to track AI/bot activity

Parameters:
- issueId: string (required) - Issue ID or identifier (e.g., "ABC-123" or UUID)
- externalLink: string (optional) - URL of external agent-hosted page

Linear SDK Methods Used:
- linearClient.client.rawRequest() - Raw GraphQL mutation
- Mutation: agentSessionCreateOnIssue

GraphQL Mutation:
mutation AgentSessionCreateOnIssue($input: AgentSessionCreateOnIssue!) {
  agentSessionCreateOnIssue(input: $input) {
    success
    lastSyncId
    agentSession {
      id
    }
  }
}

Returns:
- success: boolean
- agentSessionId: string
- lastSyncId: number

Callbacks:
- options.onSessionCreated(agentSessionId, parentSessionId) - Register child-to-parent mapping

Operation Type: Write
```

### Tool: `linear_agent_session_create_on_comment`

```typescript
Location: packages/claude-runner/src/tools/cyrus-tools/index.ts:352-452

Description: Create an agent session on a Linear root comment (not a reply) to trigger a sub-agent

Parameters:
- commentId: string (required) - Root comment ID (must not be a reply)
- externalLink: string (optional) - URL of external agent-hosted page

Linear SDK Methods Used:
- linearClient.client.rawRequest() - Raw GraphQL mutation
- Mutation: agentSessionCreateOnComment

GraphQL Mutation:
mutation AgentSessionCreateOnComment($input: AgentSessionCreateOnComment!) {
  agentSessionCreateOnComment(input: $input) {
    success
    lastSyncId
    agentSession {
      id
    }
  }
}

Returns:
- success: boolean
- agentSessionId: string
- lastSyncId: number

Callbacks:
- options.onSessionCreated(agentSessionId, parentSessionId) - Register child-to-parent mapping

Operation Type: Write

Reference: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/inputs/AgentSessionCreateOnComment
```

### Tool: `linear_agent_give_feedback`

```typescript
Location: packages/claude-runner/src/tools/cyrus-tools/index.ts:454-531

Description: Provide feedback to a child agent session to continue its processing

Parameters:
- agentSessionId: string (required) - Child agent session ID to give feedback to
- message: string (required) - Feedback message to send

Linear SDK Methods Used:
- None directly (uses callback mechanism)

Callbacks:
- options.onFeedbackDelivery(agentSessionId, message) - Deliver feedback to parent session

Returns:
- success: boolean

Operation Type: Write (indirect via callback)

Note: This tool queues feedback for delivery but doesn't directly interact with Linear API. The actual delivery happens through the EdgeWorker's feedback delivery mechanism.
```

### Tool: `linear_get_child_issues`

```typescript
Location: packages/claude-runner/src/tools/cyrus-tools/index.ts:533-673

Description: Get all child issues (sub-issues) for a given Linear issue

Parameters:
- issueId: string (required) - Parent issue ID or identifier (e.g., 'CYHOST-91' or UUID)
- limit: number (optional) - Max results (default: 50, max: 250)
- includeCompleted: boolean (optional) - Include completed children (default: true)
- includeArchived: boolean (optional) - Include archived children (default: false)

Linear SDK Methods Used:
- linearClient.issue(issueId) - Fetch parent issue
- issue.children({ first, filter }) - Fetch child issues with filters
- childrenConnection.nodes - Get array of child issues
- child.state, child.assignee (async properties)

Filter Construction:
if (!includeCompleted) {
  filter.state = { type: { neq: "completed" } };
}
if (!includeArchived) {
  filter.archivedAt = { null: true };
}

Returns:
- success: boolean
- parentIssue: { id, identifier, title, url }
- childCount: number
- children: Array<{
    id: string
    identifier: string
    title: string
    state: string
    stateType: string | null
    assignee: string | null
    assigneeId: string | null
    priority: number
    priorityLabel: string
    createdAt: string
    updatedAt: string
    url: string
    archivedAt: string | null
  }>

Operation Type: Read
```

---

## Linear Webhook Types

All webhook types are defined in `packages/core/src/webhook-types.ts`.

### Base Structures

#### `LinearWebhookTeam`
```typescript
Location: packages/core/src/webhook-types.ts:11-15

interface LinearWebhookTeam {
  id: string;        // e.g. "e66a639b-d4a1-433d-be4f-8c0438d42cd9"
  key: string;       // e.g. "CEA"
  name: string;      // e.g. "CeedarAgents"
}

Usage: Team information in webhook payloads
```

#### `LinearWebhookIssue`
```typescript
Location: packages/core/src/webhook-types.ts:20-27

interface LinearWebhookIssue {
  id: string;          // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
  title: string;       // e.g. "test issue"
  teamId: string;      // e.g. "e66a639b-d4a1-433d-be4f-8c0438d42cd9"
  team: LinearWebhookTeam;
  identifier: string;  // e.g. "CEA-85"
  url: string;        // e.g. "https://linear.app/ceedaragents/issue/CEA-85/test-issue"
}

Usage: Issue information in webhook payloads
```

#### `LinearWebhookComment`
```typescript
Location: packages/core/src/webhook-types.ts:32-37

interface LinearWebhookComment {
  id: string;       // e.g. "3a5950aa-4f8c-4709-88be-e12b7f40bf78"
  body: string;     // e.g. "this is a root comment"
  userId: string;   // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  issueId: string;  // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
}

Usage: Comment information in webhook payloads
```

#### `LinearWebhookActor`
```typescript
Location: packages/core/src/webhook-types.ts:42-47

interface LinearWebhookActor {
  id: string;      // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  name: string;    // e.g. "Connor Turland"
  email: string;   // e.g. "connor@ceedar.ai"
  url: string;     // e.g. "https://linear.app/ceedaragents/profiles/connor"
}

Usage: Actor (user) information in webhook payloads
```

#### `LinearWebhookNotificationBase`
```typescript
Location: packages/core/src/webhook-types.ts:52-63

interface LinearWebhookNotificationBase {
  id: string;                      // e.g. "07de24f2-c624-48cd-90c2-a04dfd54ce48"
  createdAt: string;               // e.g. "2025-06-13T16:27:42.232Z"
  updatedAt: string;               // e.g. "2025-06-13T16:27:42.232Z"
  archivedAt: string | null;       // null when not archived
  actorId: string;                 // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  externalUserActorId: string | null; // null for internal users
  userId: string;                  // e.g. "316d0aca-caf4-4c5a-88c3-628e107ce6c6"
  issueId: string;                 // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
  issue: LinearWebhookIssue;
  actor: LinearWebhookActor;
}

Usage: Base structure for all notification webhooks
```

### Notification Types

#### `LinearIssueAssignedNotification`
```typescript
Location: packages/core/src/webhook-types.ts:68-71

interface LinearIssueAssignedNotification extends LinearWebhookNotificationBase {
  type: "issueAssignedToYou";
}

Usage: Notification when an issue is assigned to the bot user
Operation Type: Read
```

#### `LinearIssueCommentMentionNotification`
```typescript
Location: packages/core/src/webhook-types.ts:76-81

interface LinearIssueCommentMentionNotification extends LinearWebhookNotificationBase {
  type: "issueCommentMention";
  commentId: string;
  comment: LinearWebhookComment;
}

Usage: Notification when bot is mentioned in a comment
Operation Type: Read
```

#### `LinearIssueNewCommentNotification`
```typescript
Location: packages/core/src/webhook-types.ts:86-93

interface LinearIssueNewCommentNotification extends LinearWebhookNotificationBase {
  type: "issueNewComment";
  commentId: string;
  comment: LinearWebhookComment;
  parentCommentId?: string;      // Only present for reply comments
  parentComment?: LinearWebhookComment; // Only present for reply comments
}

Usage: Notification when a new comment is added to an issue the bot is tracking
Operation Type: Read
```

#### `LinearIssueUnassignedNotification`
```typescript
Location: packages/core/src/webhook-types.ts:98-107

interface LinearIssueUnassignedNotification extends LinearWebhookNotificationBase {
  type: "issueUnassignedFromYou";
  actorId: string;
  externalUserActorId: string | null;
  userId: string;
  issueId: string;
  issue: LinearWebhookIssue;
  actor: LinearWebhookActor;
}

Usage: Notification when an issue is unassigned from the bot user
Operation Type: Read
```

### Webhook Payloads

#### `LinearIssueAssignedWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:121-131

interface LinearIssueAssignedWebhook {
  type: "AppUserNotification";
  action: "issueAssignedToYou";
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  notification: LinearIssueAssignedNotification;
  webhookTimestamp: number;
  webhookId: string;
}

Usage: Full webhook payload for issue assignment
Operation Type: Read
```

#### `LinearIssueCommentMentionWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:136-146

interface LinearIssueCommentMentionWebhook {
  type: "AppUserNotification";
  action: "issueCommentMention";
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  notification: LinearIssueCommentMentionNotification;
  webhookTimestamp: number;
  webhookId: string;
}

Usage: Full webhook payload for comment mention
Operation Type: Read
```

#### `LinearIssueNewCommentWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:151-161

interface LinearIssueNewCommentWebhook {
  type: "AppUserNotification";
  action: "issueNewComment";
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  notification: LinearIssueNewCommentNotification;
  webhookTimestamp: number;
  webhookId: string;
}

Usage: Full webhook payload for new comment
Operation Type: Read
```

#### `LinearIssueUnassignedWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:166-176

interface LinearIssueUnassignedWebhook {
  type: "AppUserNotification";
  action: "issueUnassignedFromYou";
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  notification: LinearIssueUnassignedNotification;
  webhookTimestamp: number;
  webhookId: string;
}

Usage: Full webhook payload for issue unassignment
Operation Type: Read
```

### Agent Session Types

#### `LinearWebhookCreator`
```typescript
Location: packages/core/src/webhook-types.ts:181-187

interface LinearWebhookCreator {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  url: string;
}

Usage: Creator information in agent session webhooks
```

#### `LinearWebhookAgentSession`
```typescript
Location: packages/core/src/webhook-types.ts:203-222

interface LinearWebhookAgentSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  creatorId: string;
  appUserId: string;
  commentId: string;
  issueId: string;
  status: "pending" | "active" | "error" | "awaiting-input" | "complete";
  startedAt: string | null;
  endedAt: string | null;
  type: "commentThread";
  summary: string | null;
  sourceMetadata: any | null;
  organizationId: string;
  creator: LinearWebhookCreator;
  comment: LinearWebhookComment;
  issue: LinearWebhookIssue;
}

Usage: Agent session information in agent session webhooks
```

#### `LinearWebhookAgentActivityContent`
```typescript
Location: packages/core/src/webhook-types.ts:227-236

interface LinearWebhookAgentActivityContent {
  type: "prompt" | "observation" | "action" | "error" | "elicitation" | "response";
  body: string;
}

Usage: Content type for agent activity
```

#### `LinearWebhookAgentActivity`
```typescript
Location: packages/core/src/webhook-types.ts:241-251

interface LinearWebhookAgentActivity {
  id: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  agentContextId: string | null;
  agentSessionId: string;
  sourceCommentId: string;
  content: LinearWebhookAgentActivityContent;
  signal?: "stop"; // Optional signal modifier for user intent
}

Usage: Agent activity information in prompted webhooks
```

#### `LinearAgentSessionCreatedWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:256-267

interface LinearAgentSessionCreatedWebhook {
  type: "AgentSessionEvent";
  action: "created";
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  agentSession: LinearWebhookAgentSession;
  guidance?: LinearWebhookGuidanceRule[];
  webhookTimestamp: string;
  webhookId: string;
}

Usage: Full webhook payload when an agent session is created
Operation Type: Read
```

#### `LinearAgentSessionPromptedWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:272-284

interface LinearAgentSessionPromptedWebhook {
  type: "AgentSessionEvent";
  action: "prompted";
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  agentSession: LinearWebhookAgentSession;
  agentActivity: LinearWebhookAgentActivity;
  guidance?: LinearWebhookGuidanceRule[];
  webhookTimestamp: string;
  webhookId: string;
}

Usage: Full webhook payload when an agent session receives a user prompt
Operation Type: Read
```

### Guidance Types (Re-exported from @linear/sdk)

```typescript
Location: packages/core/src/webhook-types.ts:192-198

export type LinearWebhookGuidanceRule = LinearDocument.GuidanceRuleWebhookPayload;
export type LinearWebhookOrganizationOrigin = LinearDocument.OrganizationOriginWebhookPayload;
export type LinearWebhookTeamOrigin = LinearDocument.TeamOriginWebhookPayload;
export type LinearWebhookTeamWithParent = LinearDocument.TeamWithParentWebhookPayload;

Usage: Agent guidance configuration types from Linear SDK
Operation Type: Read (Type only)
```

### Union Types

#### `LinearWebhookNotification`
```typescript
Location: packages/core/src/webhook-types.ts:112-116

type LinearWebhookNotification =
  | LinearIssueAssignedNotification
  | LinearIssueCommentMentionNotification
  | LinearIssueNewCommentNotification
  | LinearIssueUnassignedNotification;

Usage: Union of all notification types
```

#### `LinearWebhook`
```typescript
Location: packages/core/src/webhook-types.ts:289-295

type LinearWebhook =
  | LinearIssueAssignedWebhook
  | LinearIssueCommentMentionWebhook
  | LinearIssueNewCommentWebhook
  | LinearIssueUnassignedWebhook
  | LinearAgentSessionCreatedWebhook
  | LinearAgentSessionPromptedWebhook;

Usage: Union of all webhook payload types
```

### Type Guards

```typescript
Location: packages/core/src/webhook-types.ts:300-334

export function isIssueAssignedWebhook(
  webhook: LinearWebhook
): webhook is LinearIssueAssignedWebhook {
  return webhook.action === "issueAssignedToYou";
}

export function isIssueCommentMentionWebhook(
  webhook: LinearWebhook
): webhook is LinearIssueCommentMentionWebhook {
  return webhook.action === "issueCommentMention";
}

export function isIssueNewCommentWebhook(
  webhook: LinearWebhook
): webhook is LinearIssueNewCommentWebhook {
  return webhook.action === "issueNewComment";
}

export function isIssueUnassignedWebhook(
  webhook: LinearWebhook
): webhook is LinearIssueUnassignedWebhook {
  return webhook.action === "issueUnassignedFromYou";
}

export function isAgentSessionCreatedWebhook(
  webhook: LinearWebhook
): webhook is LinearAgentSessionCreatedWebhook {
  return webhook.type === "AgentSessionEvent" && webhook.action === "created";
}

export function isAgentSessionPromptedWebhook(
  webhook: LinearWebhook
): webhook is LinearAgentSessionPromptedWebhook {
  return webhook.type === "AgentSessionEvent" && webhook.action === "prompted";
}

Usage: Type narrowing functions for webhook discrimination in handleWebhook()
Operation Type: Read (Type narrowing)
```

---

## Linear-Specific Types

Types that directly depend on Linear SDK types and need abstraction.

### `packages/core/src/CyrusAgentSession.ts`

```typescript
Location: packages/core/src/CyrusAgentSession.ts

import { LinearDocument } from "@linear/sdk";

interface CyrusAgentSession {
  linearAgentActivitySessionId: string;
  claudeSessionId?: string;
  type: LinearDocument.AgentSessionType; // "commentThread"
  status: LinearDocument.AgentSessionStatus; // "pending" | "active" | "error" | "awaiting-input" | "complete"
  context: LinearDocument.AgentSessionType;
  createdAt: number;
  updatedAt: number;
  issueId: string;
  issue?: IssueMinimal;
  workspace: Workspace;
  metadata?: {
    model?: string;
    tools?: any[];
    permissionMode?: string;
    apiKeySource?: string;
    totalCostUsd?: number;
    usage?: any;
    procedureId?: string;
    subroutineIndex?: number;
    claudeSessionIds?: string[];
  };
}

Linear Dependencies:
- LinearDocument.AgentSessionType
- LinearDocument.AgentSessionStatus

These need to be abstracted to platform-agnostic enums.
```

### `packages/core/src/config-types.ts`

```typescript
Location: packages/core/src/config-types.ts

interface RepositoryConfig {
  id: string;
  repositoryPath: string;
  workspaceBaseDir: string;
  linearToken: string;  // Linear-specific
  linearUserId?: string; // Linear-specific
  linearUserEmail?: string; // Linear-specific
  teamKeys?: string[];  // Linear-specific (team key routing)
  projectKeys?: string[]; // Linear-specific (project key routing)
  routingLabels?: string[]; // Linear-specific (label-based routing)
  // ... other fields
}

Linear Dependencies:
- linearToken
- linearUserId
- linearUserEmail
- teamKeys (Linear team concept)
- projectKeys (Linear project concept)
- routingLabels (Linear label concept)

These need to be abstracted to platform-agnostic authentication and routing config.
```

### `packages/edge-worker/src/types.ts`

```typescript
Location: packages/edge-worker/src/types.ts

interface LinearAgentSessionData {
  issue: LinearWebhookIssue;
  session: LinearWebhookAgentSession;
  repository: RepositoryConfig;
}

Linear Dependencies:
- LinearWebhookIssue
- LinearWebhookAgentSession

These are webhook-specific types that need abstraction.
```

### `packages/edge-worker/src/prompt-assembly/types.ts`

```typescript
Location: packages/edge-worker/src/prompt-assembly/types.ts:109

interface PromptAssemblyInput {
  // ... other fields
  agentSession?: LinearWebhookAgentSession;
  // ... other fields
}

Linear Dependencies:
- LinearWebhookAgentSession

This needs to be abstracted to a platform-agnostic session type.
```

---

## Abstraction Requirements

### 1. Issue Tracking Platform Interface

The abstraction layer needs to support these operations:

#### Read Operations
- **Fetch Issue**: Get issue by ID or identifier
- **Fetch Issue State**: Get current state/status of an issue
- **Fetch Issue Assignee**: Get assignee information
- **Fetch Issue Team**: Get team information
- **Fetch Issue Children**: Get sub-issues with filtering
- **Fetch Comments**: Get comments for an issue with pagination
- **Fetch Comment**: Get comment by ID
- **Fetch Teams**: List all teams
- **Fetch Labels**: List all issue labels
- **Fetch Workflow States**: List available states/statuses
- **Property Access**: Async property access pattern (issue.state, issue.assignee, etc.)

#### Write Operations
- **Create Agent Activity**: Post activity to an agent session (action, thought, observation, elicitation, response, error)
- **Create Comment**: Post comment to an issue
- **Update Issue**: Update issue properties (state, assignee, etc.)
- **Upload File**: Upload file and get asset URL
- **Create Agent Session on Issue**: Start tracking AI/bot activity on an issue
- **Create Agent Session on Comment**: Start tracking AI/bot activity on a comment thread

#### Raw GraphQL/API Access
- **Raw Request**: Execute custom GraphQL queries/mutations for advanced operations
  - agentSessionCreateOnIssue
  - agentSessionCreateOnComment
  - Custom queries with attachments

### 2. Webhook System Interface

The abstraction layer needs to handle:

#### Webhook Events
- **Issue Assigned**: Bot is assigned to an issue
- **Issue Unassigned**: Bot is unassigned from an issue
- **Comment Mention**: Bot is mentioned in a comment
- **New Comment**: New comment on tracked issue
- **Agent Session Created**: New agent session started
- **Agent Session Prompted**: User provides feedback to agent session

#### Webhook Verification
- **Signature Verification**: Verify webhook authenticity using secret
- **Bearer Token Authentication**: Support proxy mode with API key

#### Event Transport
- **EventEmitter Pattern**: Emit events for webhook delivery
- **Error Handling**: Emit errors for webhook processing failures

### 3. Type System Abstraction

The abstraction layer needs platform-agnostic types for:

#### Core Entities
- **Issue**: id, identifier, title, description, url, state, assignee, team, labels, priority
- **Comment**: id, body, userId, issueId, createdAt, parentId
- **User/Actor**: id, name, email, url, avatarUrl
- **Team**: id, key, name
- **State/Status**: id, name, type (e.g., "triage", "backlog", "started", "completed")
- **Label**: id, name, color

#### Agent Sessions
- **AgentSession**: id, issueId, commentId, status, type, createdAt, updatedAt, metadata
- **AgentSessionStatus**: Enum - pending, active, error, awaiting-input, complete
- **AgentSessionType**: Enum - commentThread, issue, document
- **AgentActivity**: id, sessionId, content, type, createdAt
- **AgentActivityContentType**: Enum - prompt, observation, action, error, elicitation, response, thought

#### Configuration
- **PlatformConfig**: Authentication credentials, user ID, workspace/organization ID
- **RoutingConfig**: Team keys, project keys, labels for repository routing
- **WebhookConfig**: Verification mode, secret, endpoint URL

### 4. Async Property Pattern

Linear SDK uses async property access (e.g., `await issue.state`). The abstraction needs to:
- Support both sync and async property access
- Provide consistent interface across platforms
- Handle lazy loading of related entities

### 5. Filtering & Pagination

The abstraction needs to support:
- **Filters**: Complex filter objects (e.g., `{ state: { type: { neq: "completed" } } }`)
- **Pagination**: Cursor-based or offset-based pagination
- **Limit/Offset**: Control result count

### 6. File Upload Pattern

The abstraction needs to:
- Request upload URL from platform
- Upload file to cloud storage
- Return asset URL for use in content
- Support MIME type detection
- Support public/private files

### 7. GraphQL Access Pattern

Some platforms (like Linear) require raw GraphQL for advanced features:
- The abstraction should provide high-level methods where possible
- Fall back to raw API access for platform-specific features
- Document which operations require raw access

---

## Recommendations for Abstraction Design

### 1. Strategy Pattern
Use the Strategy pattern to encapsulate platform-specific implementations:

```typescript
interface IssueTrackingPlatform {
  // Read operations
  fetchIssue(id: string): Promise<Issue>;
  fetchIssueChildren(id: string, options?: FilterOptions): Promise<Issue[]>;
  fetchComments(issueId: string, options?: PaginationOptions): Promise<Comment[]>;
  // ... other read operations

  // Write operations
  createAgentActivity(sessionId: string, activity: AgentActivity): Promise<void>;
  createComment(issueId: string, body: string): Promise<Comment>;
  updateIssue(id: string, updates: Partial<Issue>): Promise<Issue>;
  // ... other write operations

  // Advanced operations
  rawRequest<T>(query: string, variables: any): Promise<T>;
}

class LinearPlatform implements IssueTrackingPlatform {
  // Implementation using @linear/sdk
}
```

### 2. Adapter Pattern
Use adapters to transform between platform-specific types and abstract types:

```typescript
class LinearWebhookAdapter {
  toGenericWebhook(linearWebhook: LinearWebhook): GenericWebhook {
    // Transform Linear webhook to generic webhook
  }
}

class LinearIssueAdapter {
  toGenericIssue(linearIssue: LinearIssue): Issue {
    // Transform Linear issue to generic issue
  }
}
```

### 3. Factory Pattern
Use factories to create platform-specific instances:

```typescript
class PlatformFactory {
  static create(config: PlatformConfig): IssueTrackingPlatform {
    switch (config.type) {
      case 'linear':
        return new LinearPlatform(config);
      case 'github':
        return new GitHubPlatform(config);
      // ... other platforms
    }
  }
}
```

### 4. Repository Pattern
Separate data access from business logic:

```typescript
class IssueRepository {
  constructor(private platform: IssueTrackingPlatform) {}

  async getIssueWithChildren(id: string): Promise<IssueWithChildren> {
    const issue = await this.platform.fetchIssue(id);
    const children = await this.platform.fetchIssueChildren(id);
    return { issue, children };
  }
}
```

### 5. Event Bus Pattern
Decouple webhook handling from business logic:

```typescript
class WebhookEventBus {
  private platform: IssueTrackingPlatform;

  constructor(platform: IssueTrackingPlatform) {
    this.platform = platform;
  }

  emit(event: WebhookEvent): void {
    // Transform and emit platform-agnostic event
  }
}
```

---

## File Summary by Operation Type

### Read Operations (26 sites)
- EdgeWorker.ts: issue(), comment(), comments(), teams(), issueLabels(), workflowStates(), property access
- AgentSessionManager.ts: (no direct reads, uses passed LinearClient)
- cyrus-tools/index.ts: issue(), issue.children(), property access
- linear-event-transport: webhook verification (read-only)

### Write Operations (19 sites)
- EdgeWorker.ts: createAgentActivity() (15x), updateIssue() (1x), createComment() (1x)
- AgentSessionManager.ts: createAgentActivity() (10x)
- cyrus-tools/index.ts: fileUpload() (1x), raw GraphQL mutations (2x)

### Raw GraphQL (3 sites)
- EdgeWorker.ts: client.rawRequest() for comment attachments (1x)
- cyrus-tools/index.ts: client.rawRequest() for agent session creation (2x)

### Type Imports (4 sites)
- webhook-types.ts: LinearDocument types
- CyrusAgentSession.ts: LinearDocument enums
- linear-event-transport: LinearWebhookPayload
- EdgeWorker.ts: Comment, LinearIssue types

---

## Next Steps for CYPACK-306

1. **Design Abstract Interfaces**: Define platform-agnostic interfaces based on this catalog
2. **Create Type Mappings**: Map Linear-specific types to abstract types
3. **Implement Adapters**: Build adapters for Linear → Abstract transformation
4. **Refactor EdgeWorker**: Replace direct Linear SDK calls with abstract interface
5. **Refactor AgentSessionManager**: Replace Linear SDK dependency with abstract interface
6. **Update Cyrus Tools**: Make tools platform-agnostic or create platform-specific tool factories
7. **Abstract Webhook System**: Create generic webhook types and verification interface
8. **Update Configuration**: Replace Linear-specific config with platform-agnostic config
9. **Add Tests**: Ensure abstraction layer works correctly
10. **Document Migration**: Provide migration guide for adding new platforms

---

**End of Audit Document**
