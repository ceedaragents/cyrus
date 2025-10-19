# cyrus-interfaces

TypeScript interface definitions for Cyrus I/O abstractions.

## Overview

This package provides the foundational interfaces for Cyrus's interface-driven architecture. It contains pure TypeScript interface definitions with no implementation code, allowing different adapters to be built and swapped without changing core logic.

## Interfaces

### IUserInterface

Represents any system that can send work to Cyrus and receive results. This allows Cyrus to work with different input/output systems (Linear, CLI, HTTP, etc.).

**Key methods:**
- `initialize()` / `shutdown()` - Lifecycle management
- `onWorkItem()` - Receive work items
- `postActivity()` - Send activity updates
- `updateWorkItem()` - Update work item status
- `getWorkItem()` / `getWorkItemHistory()` - Query work items

### IAgentRunner

Abstract interface for any AI/agent tool (Claude, GPT, Cursor, etc.). This allows Cyrus to work with different AI agents without tight coupling.

**Key methods:**
- `initialize()` / `cleanup()` - Lifecycle management
- `execute()` - Execute an agent session
- `onMessage()` / `onComplete()` / `onError()` - Event handlers

### IWorkspaceManager

Manages isolated workspaces for processing work items. Workspaces can be implemented using git worktrees, docker containers, VMs, etc.

**Key methods:**
- `createWorkspace()` - Create a new workspace
- `destroyWorkspace()` - Clean up a workspace
- `getWorkspace()` / `listWorkspaces()` - Query workspaces

### IPersistence

Generic persistence interface for storing and retrieving data. Can be implemented using file system, databases, cloud storage, etc.

**Key methods:**
- `save()` - Save data
- `load()` - Load data
- `delete()` - Delete data
- `list()` - List keys

## Installation

```bash
pnpm add cyrus-interfaces
```

## Usage

```typescript
import type {
  IUserInterface,
  IAgentRunner,
  IWorkspaceManager,
  IPersistence,
} from 'cyrus-interfaces';

// Implement the interfaces
class MyUserInterface implements IUserInterface {
  async initialize(): Promise<void> {
    // Implementation
  }

  // ... other methods
}
```

## Documentation

All interfaces are fully documented with JSDoc comments. TypeScript will provide autocomplete and inline documentation in your IDE.

## Architecture

This package is part of the Cyrus I/O architecture redesign. See `IO_ARCHITECTURE.md` in the repository root for the complete architecture design.

## License

MIT
