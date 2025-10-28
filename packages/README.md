# Cyrus Packages

This directory contains the core packages that make up the Cyrus monorepo. Each package has a specific scope of concerns and well-defined responsibilities.

## Package Overview

### @cyrus/core
**Scope**: Core domain models and business logic entities

**Responsibilities**:
- Define core business entities (Session, Issue, Workspace, Comment)
- Manage session lifecycle and state
- Provide shared TypeScript types and interfaces
- Handle session persistence and retrieval

**Key Exports**:
- `Session` - Represents a Claude coding session
- `SessionManager` - Manages multiple active sessions
- `Issue` - Linear issue model
- `Workspace` - Working directory model
- `Comment` - Issue comment model

### @cyrus/claude-parser
**Scope**: Parse and interpret Claude's stdout/stderr output

**Responsibilities**:
- Parse Claude's JSON-formatted stdout messages
- Handle streaming JSON parsing (incomplete messages)
- Emit typed events for different message types
- Extract content from assistant responses
- Parse tool use events and errors

**Key Exports**:
- `StdoutParser` - Main parser class
- `StreamProcessor` - Handles streaming data
- `ClaudeEvent` - TypeScript types for all Claude events
- Message type definitions

### @cyrus/claude-runner
**Scope**: Manage Claude CLI process lifecycle

**Responsibilities**:
- Spawn and manage Claude CLI processes
- Handle process arguments and environment setup
- Send prompts and input to Claude
- Kill/restart processes as needed
- Configure allowed tools and working directory
- Handle --continue flag for session continuation

**Key Exports**:
- `ClaudeRunner` - Main process manager
- `getAllTools()` - List available Claude tools
- Process configuration types

### @cyrus/linear-event-transport
**Scope**: Direct Linear webhook handling with HMAC verification

**Responsibilities**:
- Receive webhooks directly from Linear
- Verify HMAC signatures using Linear SDK
- Register webhooks with Linear automatically
- Emit webhook events for processing
- Handle webhook lifecycle (connect/disconnect)

**Key Exports**:
- `LinearEventTransport` - Main transport class
- `LinearWebhookPayload` - Webhook payload types
- Configuration interfaces

### @cyrus/edge-worker
**Scope**: Orchestrate Linear webhooks, Claude processing, and API responses

**Responsibilities**:
- Process Linear webhook events (issue assignment, comments)
- Manage Claude sessions for each issue
- Post responses back to Linear via API
- Handle multiple repository/workspace configurations
- Coordinate between all other packages
- Manage SharedApplicationServer for webhook routing

**Key Exports**:
- `EdgeWorker` - Main orchestrator class
- `SharedApplicationServer` - Webhook server
- `RepositoryConfig` - Repository configuration
- `EdgeWorkerConfig` - Full configuration interface
- Event types and handlers

## Package Dependencies

```
@cyrus/edge-worker
  ├── @cyrus/core (Session, SessionManager)
  ├── @cyrus/claude-parser (ClaudeEvent types)
  ├── @cyrus/claude-runner (ClaudeRunner)
  ├── @cyrus/linear-event-transport (LinearEventTransport)
  └── @linear/sdk (Linear API)

@cyrus/claude-runner
  └── @cyrus/claude-parser (for event types)

@cyrus/linear-event-transport
  └── @linear/sdk/webhooks (Linear webhook handling)

@cyrus/claude-parser
  └── (no internal dependencies)

@cyrus/core
  └── (no internal dependencies)
```

## Design Principles

1. **Single Responsibility**: Each package has one clear purpose
2. **Minimal Dependencies**: Packages depend only on what they need
3. **Type Safety**: All packages export TypeScript types
4. **Event-Driven**: Packages communicate via events where appropriate
5. **Testable**: Each package can be tested in isolation
6. **Reusable**: Packages can be used independently in different contexts

## Usage in Apps

- **CLI App**: Uses all packages to provide a command-line interface
- **Electron App**: Uses edge-worker package for the main functionality
- **Future Apps**: Can pick and choose packages based on needs