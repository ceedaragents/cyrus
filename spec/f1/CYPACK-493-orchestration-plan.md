# CYPACK-493: F1 Testing Framework Orchestration Plan

## Overview

This document outlines the decomposition of CYPACK-493 into a Graphite stack of sub-issues. The F1 framework will enable end-to-end testing of the Cyrus product by implementing a CLI-based issue tracker that simulates Linear's behavior.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          F1 CLI Interface                            │
│                  (Commander.js CLI with Bun runtime)                 │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ HTTP POST /cli/rpc (JSON-RPC)
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        CLIRPCServer.ts                               │
│            (Fastify server, RPC endpoint handler)                    │
│   Handles: ping, status, createIssue, assignIssue, viewSession, etc. │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   CLIIssueTrackerService.ts                          │
│           (Implements IIssueTrackerService interface)                │
│                      In-memory state storage                         │
│    Stores: issues, comments, sessions, activities, users, teams     │
└──────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        EdgeWorker.ts                                 │
│       (Orchestration layer - manages agent sessions & runners)       │
│              Modified to support platform: "cli"                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Dependency Flow (Graphite Stack Order)

The sub-issues will be created in the following order, with each issue building on the previous:

1. **Sub-issue 1**: Core Types and CLI State Management
   - Define CLI-specific types that mirror Linear SDK types
   - Create in-memory state store for issues, comments, sessions, activities

2. **Sub-issue 2**: CLIIssueTrackerService Implementation
   - Implement all 27 methods of IIssueTrackerService
   - Use synchronous properties (unlike Linear's async getters)
   - Proper mocking of Linear behavior

3. **Sub-issue 3**: CLIRPCServer Implementation
   - Create Fastify-based RPC server
   - Implement JSON-RPC 2.0 protocol
   - Route commands to CLIIssueTrackerService

4. **Sub-issue 4**: EdgeWorker CLI Platform Support
   - Add platform: "cli" configuration option
   - Modify EdgeWorker to instantiate CLI adapters
   - Skip Cloudflare tunnel when in CLI mode

5. **Sub-issue 5**: F1 CLI Tool Implementation
   - Create Commander.js CLI binary
   - Implement all commands with beautiful colored output
   - Pagination, search, and help system

6. **Sub-issue 6**: F1 Server Entry Point
   - Create apps/f1/server.ts
   - Configure EdgeWorker with CLI platform
   - Beautiful startup output

7. **Sub-issue 7**: Integration Tests and Test Drive Documentation
   - End-to-end tests for the F1 framework
   - Test drive templates and documentation

## Acceptance Criteria Summary

### Code Quality
- Uses `bun` for running server and CLI commands
- Absolutely ZERO `any` types
- Properly implements IIssueTrackerService interface (no changes to interface)
- Accurate mocking of Linear SDK behavior
- DRY code with minimal repetition
- Each CLI command in its own file
- Short file lengths
- Uses Commander.js framework

### Platform Configuration
- `platform: "cli" as const` in EdgeWorker config
- No Cloudflare tunnel when using CLI platform

## Files to be Created

```
apps/f1/
├── CLAUDE.md                    # Documentation for the F1 CLI platform
├── server.ts                    # Server entry point (run with bun)
├── f1                           # CLI binary (executable)
├── README.md                    # Overview documentation
└── test-drives/                 # Test drive logs and findings

packages/core/src/issue-tracker/adapters/
├── cli/
│   ├── CLIIssueTrackerService.ts    # Implements IIssueTrackerService
│   ├── CLIRPCServer.ts               # JSON-RPC server
│   ├── types.ts                      # CLI-specific types
│   └── state.ts                      # In-memory state management
│   └── index.ts                      # Exports
```

## Key Implementation Notes

### 1. Synchronous Properties (Unlike Linear)

Linear SDK has async properties that must be awaited:
```typescript
// Linear SDK (async properties)
const issue = await linearService.fetchIssue('TEAM-123');
const state = await issue.state; // Promise<WorkflowState>
```

CLI implementation uses synchronous properties:
```typescript
// CLI Implementation (sync properties)
const issue = await cliService.fetchIssue('CLI-1');
const state = issue.state; // WorkflowState (not a Promise)
```

### 2. In-Memory State

All data is stored in-memory during the server session:
- Issues: Map<issueId, Issue>
- Comments: Map<commentId, Comment>
- Agent Sessions: Map<sessionId, AgentSession>
- Activities: Map<sessionId, AgentActivity[]>
- Users: Map<userId, User>
- Teams: Map<teamId, Team>

### 3. ID Generation

CLI platform uses simple predictable IDs:
- Issues: `issue-1`, `issue-2`, etc.
- Comments: `comment-1`, `comment-2`, etc.
- Sessions: `session-1`, `session-2`, etc.

### 4. Webhook Simulation

Instead of HTTP webhooks, the CLI platform uses:
- Direct method calls to EdgeWorker
- Event emitters for session events
- RPC commands to trigger session creation

## Stack Position Reference

| Position | Sub-Issue | Depends On | Key Deliverables |
|----------|-----------|------------|------------------|
| 1 | Core Types | None | CLI types, state store |
| 2 | CLIIssueTrackerService | 1 | All 27 IIssueTrackerService methods |
| 3 | CLIRPCServer | 2 | JSON-RPC endpoint, command routing |
| 4 | EdgeWorker CLI | 3 | platform: "cli" support |
| 5 | F1 CLI Tool | 4 | Commander.js CLI binary |
| 6 | F1 Server | 5 | apps/f1/server.ts entry point |
| 7 | Tests & Docs | 6 | Integration tests, test drives |
