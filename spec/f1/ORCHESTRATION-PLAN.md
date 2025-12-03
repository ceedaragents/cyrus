# F1 Testing Framework - Orchestration Plan

## Overview

This document outlines the orchestration plan for implementing the F1 testing framework, a CLI-based system for testing Cyrus agent sessions end-to-end.

## Architecture Summary

The F1 framework consists of three main components:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           F1 Test Framework                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌─────────────────┐   │
│  │   CLI Platform   │───▶│   EdgeWorker     │───▶│    Renderer     │   │
│  │ (Issue Tracker)  │    │  (Processing)    │    │   (Output)      │   │
│  └──────────────────┘    └──────────────────┘    └─────────────────┘   │
│                                                                          │
│  Components:                                                             │
│  - CLIIssueTrackerService (in-memory state)                             │
│  - CLIRPCServer (JSON-RPC over HTTP)                                    │
│  - F1 CLI (Commander.js client)                                         │
│  - EdgeWorker CLI platform mode                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Issue Creation**: F1 CLI → CLIRPCServer → CLIIssueTrackerService
2. **Session Trigger**: CLIIssueTrackerService → EdgeWorker event handler
3. **Agent Execution**: EdgeWorker → Claude/Gemini runner in worktree
4. **Activity Output**: Runner → CLIIssueTrackerService → CLIRPCServer → F1 CLI

## Sub-Issue Decomposition

### Sub-Issue 1: CLI Type System Foundation
**Stack Position**: 1 of 5 (First in stack)
**Scope**: Define TypeScript types for CLI platform

Creates the foundational type definitions that mirror Linear SDK types but for in-memory CLI usage:
- CLIIssue, CLIComment, CLIUser, CLITeam types
- CLIAgentSession, CLIAgentActivity types
- Type factories and ID generators
- Platform configuration types

### Sub-Issue 2: CLIIssueTrackerService Implementation
**Stack Position**: 2 of 5 (Blocked by: Sub-Issue 1)
**Scope**: Implement IIssueTrackerService for CLI platform

Full implementation of `IIssueTrackerService` interface:
- In-memory Maps for issues, comments, sessions, activities
- All CRUD operations matching Linear SDK behavior
- Event emission for state changes
- Synchronous property access (no Promises for simple gets)

### Sub-Issue 3: CLIRPCServer and Event Transport
**Stack Position**: 3 of 5 (Blocked by: Sub-Issue 2)
**Scope**: JSON-RPC server and event transport

Implements the communication layer:
- Fastify-based JSON-RPC endpoint at `/cli/rpc`
- Method routing for all CLI operations
- CLIEventTransport for in-process event delivery
- Error handling and response formatting

### Sub-Issue 4: EdgeWorker CLI Platform Mode
**Stack Position**: 4 of 5 (Blocked by: Sub-Issue 3)
**Scope**: Add CLI platform support to EdgeWorker

Modifies EdgeWorker to support `platform: "cli"`:
- Platform detection and routing in EdgeWorker constructor
- CLI-specific initialization (no Cloudflare tunnel)
- Integration with CLIIssueTrackerService and CLIRPCServer
- Worktree creation for CLI sessions

### Sub-Issue 5: F1 CLI Application
**Stack Position**: 5 of 5 (Blocked by: Sub-Issue 4)
**Scope**: Commander.js CLI and server startup

The user-facing F1 CLI:
- Commander.js command definitions
- Beautiful ANSI-colored output
- All commands: createIssue, assignIssue, startSession, viewSession, promptSession, stopSession
- Activity pagination with --limit and --offset
- server.ts startup script using Bun

## Acceptance Criteria

### Code Quality
- Zero `any` types
- Uses `bun` for server and CLI
- DRY code with shared utilities
- Each CLI command in its own file
- Short, focused file lengths
- Commander.js framework for CLI

### Interface Compliance
- Implements `IIssueTrackerService` exactly
- No changes to interface definition
- Accurate Linear SDK type mirroring
- Synchronous property access for CLI types

### Functionality
- Create issues, comments
- Assign issues to agent
- Start/stop sessions
- View session with pagination
- Prompt active sessions
- Health checks (ping, status, version)

## File Structure

```
packages/core/src/issue-tracker/adapters/
├── CLIIssueTrackerService.ts    # IIssueTrackerService implementation
├── CLIRPCServer.ts              # JSON-RPC server
├── CLIEventTransport.ts         # Event transport
└── cli-types.ts                 # CLI-specific types

apps/f1/
├── f1                           # CLI executable (shebang'd TypeScript)
├── server.ts                    # Bun server startup
├── commands/                    # Individual command files
│   ├── createIssue.ts
│   ├── assignIssue.ts
│   ├── startSession.ts
│   ├── viewSession.ts
│   ├── promptSession.ts
│   ├── stopSession.ts
│   ├── ping.ts
│   ├── status.ts
│   └── version.ts
├── lib/
│   ├── rpc-client.ts           # RPC client utilities
│   ├── colors.ts               # ANSI color helpers
│   └── formatters.ts           # Output formatting
├── test-drives/                # UX test documentation
└── CLAUDE.md                   # Developer documentation
```

## Testing Strategy

Each sub-issue includes verification requirements:
1. TypeScript type checking (`pnpm typecheck`)
2. Build verification (`pnpm build`)
3. Unit tests where applicable
4. Integration test via F1 CLI workflow

## Stack Order Rationale

The stack is ordered by dependency:
1. Types must exist before implementation
2. Service must exist before RPC server
3. RPC server must exist before EdgeWorker integration
4. EdgeWorker must support CLI before F1 app can use it

Each layer builds cleanly on the previous, minimizing merge conflicts.

---

*Generated by Cyrus Orchestrator for CYPACK-501*
