# Agent Session Result Handling

Status: Adopted  
Owner: Edge worker team  
Last Updated: 2025-09-26

## Overview

Agent results now follow a stricter mapping so Linear comment threads reflect the real health of a run:

- `subtype: "success"` → Assistant response (`content.type = "response"`).
- Any other subtype → Error semantics.
- Operational errors from runners (Codex/Claude) still land in the thread, but only terminal failures create dedicated error cards.

The goal is to keep the main conversation inline unless the run actually stops, reserving Agent “error cards” for issues that force intervention.

## Result Classification

`AgentSessionManager.syncEntryToLinear` inspects each `result` entry:

| Condition | Treated As | How it renders |
|-----------|------------|----------------|
| `subtype === "success"` | Success | `content.type = "response"` using the `result` body |
| `subtype !== "success"` but retryable (`error_during_execution`, tool errors, etc.) | Non-terminal | `content.type = "thought"` with a leading `❌` prefix |
| Terminal failures (`error_max_turns`, explicit `is_error !== false`, missing subtype) | Terminal | `content.type = "error"` |

Inline error thoughts always start with `❌ …` so operators can scan a thread and see which blocks were degraded but recoverable.

Metadata stored on session entries now includes:

- `resultSubtype` – raw subtype from the Claude SDK.
- `isTerminalError` – whether the mapped entry should surface as a Linear error card.

These flags support future analytics and downstream automation.

## Runner Error Handling

`EdgeWorker.startNonClaudeRunner` also distinguishes between recoverable and fatal runner errors:

- Errors with a structured `.cause` (Codex item failures, tool denials) post a ❌ thought.
- Errors without a cause (process crash, exit before final response) post `content.type = "error"` and stop the session.

Codex regression tests cover both flows to prevent regressions.

## Implications

1. **Linear UX** – Users see inline ❌ notes when a tool fails but the run continues, keeping the main response chronological.
2. **Proxy Worker Cards** – Reserved for failures that actually terminate the session, reducing noise for operators.
3. **Future Work** – Additional subtypes can plug into the same helpers without touching edge-worker posting code.
