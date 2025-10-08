# Procedure Routing Architecture

## Overview

This document describes the procedure routing system that intelligently routes agent sessions through different sequences of subroutines based on the nature of the request.

## Core Concepts

### Procedure
A **procedure** is a named sequence of subroutines that an agent executes from start to finish. Examples:
- `simple-question`: primary → concise-summary
- `documentation-edit`: primary → git-gh → concise-summary
- `full-development`: primary → verifications → git-gh → verbose-summary

### Subroutine
A **subroutine** is a single phase of work with a specific prompt and configuration. Examples:
- `primary`: Main work execution (debugger/builder/scoper)
- `verifications`: Run tests, linting, type checking
- `git-gh`: Commit changes and create/update PR
- `concise-summary`: Brief summary for Linear (1 turn max)
- `verbose-summary`: Detailed summary with implementation details (1 turn max)

### Routing Decision
When an agent session is created, the **ProcedureRouter** uses `SimpleClaudeRunner` to analyze the request and determine which procedure to execute.

## Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                      EdgeWorker                              │
│                                                              │
│  handleAgentSessionCreatedWebhook()                         │
│         │                                                    │
│         ├─> ProcedureRouter.determineRoutine()              │
│         │       │                                            │
│         │       ├─> SimpleClaudeRunner.query()              │
│         │       │   "Is this a question, edit, or code?"    │
│         │       │   → Returns: "question" | "edit" | "code" │
│         │       │                                            │
│         │       └─> Returns: ProcedureDefinition            │
│         │                                                    │
│         └─> session.metadata.procedure = definition         │
│                                                              │
│  resumeNextPhase() callback                                 │
│         │                                                    │
│         └─> ProcedureRouter.getNextSubroutine()             │
│                    │                                         │
│                    └─> Returns: SubroutineDefinition | null │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 ProcedureRouter                              │
│                                                              │
│  - registry: Map<string, ProcedureDefinition>               │
│  - routingRunner: SimpleClaudeRunner                        │
│                                                              │
│  + determineRoutine(request): Promise<ProcedureDefinition>  │
│  + getNextSubroutine(session): SubroutineDefinition | null  │
│  + registerProcedure(def): void                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Procedure Definitions                           │
│                                                              │
│  simple-question:                                           │
│    - primary                                                 │
│    - concise-summary                                        │
│                                                              │
│  documentation-edit:                                        │
│    - primary                                                 │
│    - git-gh                                                  │
│    - concise-summary                                        │
│                                                              │
│  full-development:                                          │
│    - primary                                                 │
│    - verifications                                          │
│    - git-gh                                                  │
│    - verbose-summary                                        │
└─────────────────────────────────────────────────────────────┘
```

## Type Definitions

```typescript
interface SubroutineDefinition {
  name: string;
  promptPath: string;
  maxTurns?: number;
  description: string;
}

interface ProcedureDefinition {
  name: string;
  description: string;
  subroutines: SubroutineDefinition[];
}

interface ProcedureMetadata {
  procedureName: string;
  currentSubroutineIndex: number;
  subroutineHistory: Array<{
    subroutine: string;
    completedAt: number;
    claudeSessionId: string;
  }>;
}
```

## Routing Decision Logic

The `ProcedureRouter` uses `SimpleClaudeRunner` with the following routing query:

```typescript
const routingRunner = new SimpleClaudeRunner({
  validResponses: ["question", "documentation", "transient", "code"] as const,
  cyrusHome: config.cyrusHome,
  systemPrompt: `You are a request classifier for a software agent system.
Analyze the request and classify it into one of these categories:
- "question": User is asking a question, seeking information
- "documentation": User wants documentation/markdown/comments edited (no code changes)
- "transient": Request involves MCP tools, temporary files, or no codebase interaction
- "code": Request involves code changes, features, bugs, refactoring`,
  maxTurns: 1,
  timeoutMs: 10000,
});

const classification = await routingRunner.query(requestText);
```

### Routing Rules

| Classification | Procedure | Subroutines |
|---------------|-----------|-------------|
| `question` | `simple-question` | primary → concise-summary |
| `documentation` | `documentation-edit` | primary → git-gh → concise-summary |
| `transient` | `simple-question` | primary → concise-summary |
| `code` | `full-development` | primary → verifications → git-gh → verbose-summary |

## Subroutine Prompts

### Primary Subroutine
- **Path**: Determined by label (debugger/builder/scoper/orchestrator)
- **Existing**: `packages/edge-worker/prompts/{debugger,builder,scoper,orchestrator}.md`
- **Config**: No maxTurns limit (run until completion)

### Verifications Subroutine (NEW)
- **Path**: `packages/edge-worker/src/prompts/subroutines/verifications.md`
- **Purpose**: Run tests, linting, type checking
- **Config**: No maxTurns limit
- **Content**: Extracted from current closure phase (verification sections only)

### Git-GH Subroutine (NEW)
- **Path**: `packages/edge-worker/src/prompts/subroutines/git-gh.md`
- **Purpose**: Commit changes and create/update PR
- **Config**: No maxTurns limit
- **Content**: Extracted from current closure phase (git/PR sections only)

### Concise Summary Subroutine (NEW)
- **Path**: `packages/edge-worker/src/prompts/subroutines/concise-summary.md`
- **Purpose**: Brief summary for simple requests
- **Config**: maxTurns = 1
- **Content**: Simplified version of current summary phase

### Verbose Summary Subroutine (RENAMED)
- **Path**: `packages/edge-worker/src/prompts/subroutines/verbose-summary.md`
- **Purpose**: Detailed summary for complex work
- **Config**: maxTurns = 1
- **Content**: Current summary phase prompt (renamed from phase-summary.md)

## Implementation Plan

### Phase 1: Type System & Router
1. Create `packages/edge-worker/src/procedures/types.ts`
2. Create `packages/edge-worker/src/procedures/ProcedureRouter.ts`
3. Create `packages/edge-worker/src/procedures/registry.ts` with predefined procedures

### Phase 2: Subroutine Prompts
1. Create `packages/edge-worker/src/prompts/subroutines/` directory
2. Split current `phase-closure.md` into:
   - `verifications.md` (testing, linting, type checking)
   - `git-gh.md` (commit, push, PR creation/update)
3. Create `concise-summary.md` (simplified summary)
4. Rename `phase-summary.md` to `subroutines/verbose-summary.md`

### Phase 3: EdgeWorker Integration
1. Update `EdgeWorker.constructor()` to initialize `ProcedureRouter`
2. Update `handleAgentSessionCreatedWebhook()`:
   - Call `router.determineRoutine()` after creating session
   - Store result in `session.metadata.procedure`
3. Update `resumeNextPhase()` callback:
   - Call `router.getNextSubroutine()` instead of hardcoded transitions
   - Load subroutine prompt from returned definition

### Phase 4: AgentSessionManager Updates
1. Update `completeSession()` to check `session.metadata.procedure`
2. Replace phase-based logic with procedure-aware logic
3. Handle procedure completion (when no more subroutines)

### Phase 5: Tests & Documentation
1. Create `packages/edge-worker/test/ProcedureRouter.test.ts`
2. Update `packages/edge-worker/test/EdgeWorker.test.ts` for procedure flow
3. Update `CHANGELOG.md` and `CLAUDE.md`

## Backward Compatibility

**Legacy Phase Support:**
- If `session.metadata.procedure` is undefined, fall back to current phase system
- Existing sessions complete with current phase-based flow
- New sessions use procedure routing

**Migration Path:**
- No breaking changes for existing sessions
- Gradual rollout: new sessions get procedure routing
- Legacy phase system can be removed after validation period

## Benefits

1. **Flexibility**: Easy to add new procedures without modifying core logic
2. **Clarity**: Each subroutine has a single, well-defined purpose
3. **Efficiency**: Skip unnecessary steps for simple requests
4. **Maintainability**: Subroutine prompts are modular and reusable
5. **Testability**: Each component can be unit tested independently
6. **Extensibility**: Register custom procedures via `ProcedureRouter.registerProcedure()`
