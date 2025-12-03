# F1 Testing Framework - Orchestrator Plan

## Overview

This document outlines the implementation plan for the F1 testing framework, which enables end-to-end testing of the Cyrus product pipeline.

## Architecture Summary

```
Issue Tracker (CLIIssueTrackerService)
         ↓
    EdgeWorker
         ↓
     Renderer
```

## Sub-Issues (Graphite Stack Order)

### 1. CYPACK-486: Design Test Repo and Rate Limiter Problem
- Create simple "rate limiter library" as the test problem
- Design test repo file structure
- Document acceptance criteria for test drives

### 2. CYPACK-487: Implement CLIIssueTrackerService
- In-memory state management for issues, comments, sessions
- Implements full IIssueTrackerService interface
- Mimics Linear SDK types accurately

### 3. CYPACK-488: Implement CLIRPCServer
- JSON-RPC over HTTP using Fastify
- Handles all CLI commands
- Integrates with CLIIssueTrackerService

### 4. CYPACK-489: Implement CLIEventTransport
- Implements IAgentEventTransport for CLI platform
- In-memory event emission
- No webhook signature verification needed

### 5. CYPACK-490: Add CLI Platform Support to EdgeWorker
- Add `platform: "cli"` option to EdgeWorkerConfig
- Conditionally use CLIIssueTrackerService
- Skip Cloudflare tunnel in CLI mode

### 6. CYPACK-491: Implement F1 CLI Commands
- Commander.js-based CLI
- All commands in separate files
- Beautiful colored output

### 7. CYPACK-492: Create F1 Server and Test Drive Subagent
- Server startup script (bun)
- Test drive subagent per Claude Code spec
- Integration testing workflow

## Code Acceptance Criteria

- Uses `bun` for running server and CLI
- Zero `any` types
- Properly implements IIssueTrackerService types
- DRY code principles
- Each CLI command in separate file
- Short file lengths
- Commander framework for CLI
- `platform: "cli"` reconfigures EdgeWorker

## Graphite Stack Status

**Stack Root**: cypack-485
**Stack Structure**:
1. CYPACK-486 (cypack-486) - Design F1 Test Repo Files → PENDING
2. CYPACK-487 (cypack-487) - CLIIssueTrackerService → PENDING (blocked by 486)
3. CYPACK-488 (cypack-488) - CLIRPCServer → PENDING (blocked by 487)
4. CYPACK-489 (cypack-489) - CLIEventTransport → PENDING (blocked by 488)
5. CYPACK-490 (cypack-490) - EdgeWorker CLI Platform → PENDING (blocked by 489)
6. CYPACK-491 (cypack-491) - F1 CLI Commands → PENDING (blocked by 490)
7. CYPACK-492 (cypack-492) - F1 Server Integration → PENDING (blocked by 491)

## Sub-Issue IDs

| Issue | ID | Status |
|-------|-----|--------|
| CYPACK-486 | ade784fa-3c2f-42bc-87ef-b717f2ca2426 | Created |
| CYPACK-487 | 68a1d79b-6995-4e2f-8d74-d5b16c2994d5 | Created |
| CYPACK-488 | c1419456-b1c7-486a-affb-77f88710368f | Created |
| CYPACK-489 | 7fc6c4dd-a5d4-4164-9626-1895f788a131 | Created |
| CYPACK-490 | 43ff37bc-6f77-4abd-8fd3-cbf98b0f9f27 | Created |
| CYPACK-491 | f19ae08a-d53c-4327-853a-3ab71314ed05 | Created |
| CYPACK-492 | 138b518b-a1f5-43dc-8491-eb59aeef4654 | Created |

## Verification Log

(To be populated as sub-issues are completed)
