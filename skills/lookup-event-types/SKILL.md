---
name: lookup-event-types
description: Look up available subscription event types and their payload shapes for a given platform (linear, github, system).
---

# Lookup Event Types

Returns the available subscription event types and their payload shapes for a given platform.

## Usage

Invoke with a platform name: `linear`, `github`, or `system`.

## Event Types

### Platform: linear

#### `issue_updated`
Fired when an issue's title, description, or attachments change.

**Filterable properties:**
- `issueId` (string) — The Linear issue ID
- `field` (string) — Which field changed: `"title"`, `"description"`, or `"attachments"`

**Payload shape:**
```json
{
  "issueId": "uuid",
  "issueIdentifier": "PROJ-123",
  "field": "title",
  "previousValue": "Old Title",
  "newValue": "New Title",
  "data": { "...full issue data from webhook..." },
  "updatedFrom": { "...previous values..." }
}
```

#### `prompted`
Fired when a user sends a prompt/comment to an agent session.

**Filterable properties:**
- `sessionId` (string) — The agent session ID

**Payload shape:**
```json
{
  "sessionId": "uuid",
  "content": "The user's message",
  "author": "User Name",
  "timestamp": "2025-01-27T12:00:00Z"
}
```

### Platform: github

#### `base_branch_updated`
Fired when new commits are pushed to a base branch that a session's repository tracks.

**Filterable properties:**
- `repositoryId` (string) — The Cyrus repository config ID
- `branch` (string) — The branch name (e.g., `"main"`)

**Payload shape:**
```json
{
  "repositoryId": "repo-id",
  "branch": "main",
  "commits": ["commit-sha-1", "commit-sha-2"],
  "pusher": "username"
}
```

#### `ci_completed`
Fired when a CI check run completes (e.g., GitHub Actions).

**Filterable properties:**
- `repositoryId` (string) — The Cyrus repository config ID
- `status` (string) — The check conclusion: `"success"`, `"failure"`, `"cancelled"`, etc.
- `checkName` (string) — The name of the check run

**Payload shape:**
```json
{
  "repositoryId": "repo-id",
  "status": "success",
  "checkName": "CI / test",
  "checkRunId": 12345,
  "headSha": "abc123",
  "url": "https://github.com/..."
}
```

#### `pull_request_review`
Fired when a pull request review is submitted.

**Filterable properties:**
- `repositoryId` (string) — The Cyrus repository config ID
- `prNumber` (string) — The PR number
- `state` (string) — Review state: `"approved"`, `"changes_requested"`, `"commented"`

**Payload shape:**
```json
{
  "repositoryId": "repo-id",
  "prNumber": "42",
  "state": "changes_requested",
  "reviewer": "username",
  "body": "Review comments..."
}
```

#### `issue_comment`
Fired when a comment is posted on an issue or PR.

**Filterable properties:**
- `repositoryId` (string) — The Cyrus repository config ID
- `issueNumber` (string) — The issue/PR number

**Payload shape:**
```json
{
  "repositoryId": "repo-id",
  "issueNumber": "42",
  "author": "username",
  "body": "Comment text...",
  "url": "https://github.com/..."
}
```

### Platform: system

#### `custom`
A generic event type for custom integrations. The payload shape is user-defined.

**Filterable properties:** User-defined key-value pairs.

**Payload shape:** User-defined.

## Subscription Examples

### Subscribe to title changes on a specific issue
```
create_subscription(
  eventType: "issue_updated",
  filter: { issueId: "abc-123", field: "title" },
  compress: { newTitle: "newValue", oldTitle: "previousValue" }
)
```

### Wait for CI to complete (one-shot)
```
create_subscription(
  eventType: "ci_completed",
  filter: { repositoryId: "my-repo", status: "success" },
  oneShot: true,
  prompt: "CI has passed! You can now proceed with the merge."
)
```

### Subscribe to base branch updates while working
```
create_subscription(
  eventType: "base_branch_updated",
  filter: { branch: "main" },
  whileStreamingOnly: true,
  prompt: "New commits on main. Consider rebasing when at a good stopping point."
)
```
