# Agent Activity Tracking

This document defines the expected behaviors for agent activity logging in Cyrus. Agent activities are the messages posted to Linear that show users what the AI agent is doing during issue processing.

## Overview

When Cyrus processes a Linear issue, it posts activities (thoughts, actions, and results) to the issue's activity feed. These activities provide transparency into the agent's reasoning and actions.

---

## Core Expected Behaviors

### 1. User Prompts Must Not Echo as Activities

**Behavior**: When a user posts a comment to a Linear issue (which becomes the agent's prompt), that comment content should NOT be echoed back as a separate agent activity.

**Rationale**: The user already sees their own comment in the Linear issue thread. Echoing it as an agent activity is redundant and creates noise in the activity feed.

**Implementation Notes**:
- The user's comment is stored in the session history for context continuity
- Only the agent's response (thoughts, actions, results) should appear as activities
- This applies to all runners: ClaudeRunner, GeminiRunner, and OpenCodeRunner

**Current Status**: Fixed in OpenCodeRunner by not emitting user messages as events.

---

### 2. Model Selection Must Be Logged

**Behavior**: At the start of each agent run, the selected model should be logged as an activity with the format: `Using model: <model-name>`

**Rationale**: Users should know which AI model is processing their issue. This is important for:
- Debugging unexpected behavior
- Understanding cost implications
- Reproducing issues with specific model versions

**Implementation**:
- Method: `postModelNotificationThought()` (AgentSessionManager.ts:1686-1715)
- Triggered when system init message is received with model information
- Creates a non-ephemeral thought activity

**Current Status**: Works for ClaudeRunner and OpenCodeRunner.

---

### 3. Procedure Selection Must Be Logged

**Behavior**: After classifying the issue and selecting a procedure, Cyrus should log the decision with format: `Selected procedure: **{procedureName}** (classified as: {classification})`

**Rationale**: Users should understand what workflow Cyrus is following to process their issue.

**Implementation**:
- Method: `postProcedureSelectionThought()` (AgentSessionManager.ts:1758-1789)
- Non-ephemeral thought activity
- Posted after AI classification completes

---

### 4. Instant Acknowledgment

**Behavior**: When Cyrus starts processing an issue, it should immediately post an ephemeral "Analyzing your request…" thought to provide feedback.

**Rationale**: Users need immediate confirmation that their request was received, even before classification completes.

**Implementation**:
- Method: `postAnalyzingThought()` (AgentSessionManager.ts:1720-1753)
- Ephemeral activity (auto-expires in Linear UI)
- Posted at session creation start

---

## Activity Types

### Thought Activities

| Activity | Ephemeral | Format | When Posted |
|----------|-----------|--------|-------------|
| Model Notification | No | `Using model: {model}` | Session initialization |
| Procedure Selection | No | `Selected procedure: **{name}** (classified as: {type})` | After classification |
| Analyzing | Yes | `Analyzing your request…` | Session start |
| Compacting (in progress) | Yes | `Compacting conversation history…` | During SDK compaction |
| Compacting (complete) | No | `Conversation history compacted` | After SDK compaction |
| Task Completed | No | `✅ Task Completed\n\n{result}` | When Task tool finishes |
| TodoWrite | No | Formatted todo list | When TodoWrite tool called |
| Validation Exhausted | No | `Validation loop exhausted after {n} attempts...` | When verification fails repeatedly |

---

### Action Activities

| Activity | Ephemeral | Format | When Posted |
|----------|-----------|--------|-------------|
| Task Start | No | Tool name + formatted parameters | When Task tool invoked |
| Subtask | Yes | `↪ {toolName}` + parameters | When tool called within Task |
| Regular Tool | Yes | Tool name + parameters | When tool invoked |
| Tool Result | No | Tool name + parameters + result | When tool completes with output |

**Tool Action Name Formatting**:
- Bash tool shows description: `Bash (List all files)`
- Error status shows flag: `Bash (Error) (List files)`
- Subtasks preserve arrow prefix: `↪ Bash`

---

### Error Activities

**Behavior**: When errors occur during agent processing, they should be logged as non-ephemeral error activities with sufficient context for debugging.

**Implementation**:
- Method: `createErrorActivity()` (AgentSessionManager.ts:1479-1513)
- Posted when subroutine fails, approval fails, or validation exhausted

---

### Response Activities

**Behavior**: Final results are posted as non-ephemeral response activities when procedures complete successfully.

**Implementation**:
- Triggered by `SDKResultMessage` with `isError: false`
- Cannot be suppressed by `suppressThoughtPosting`

---

### Approval Elicitation

**Behavior**: When a subroutine requires approval before continuing, an elicitation activity is posted with approval signal.

**Implementation**:
- Method: `createApprovalElicitation()` (AgentSessionManager.ts:1560-1602)
- Includes `signal: AgentActivitySignal.Auth`
- 30-minute timeout for approval response

---

## Ephemeral vs Persistent Activities

### Ephemeral Activities (Auto-expire in Linear UI)
- Analyzing thought
- Compacting status (in progress)
- Regular tool actions (before result)

### Persistent Activities (Remain in conversation)
- Model notification
- Procedure selection
- TodoWrite output
- Tool results with output
- Task completion
- Error activities
- Response activities
- Approval elicitations

---

## Thought Suppression

**Behavior**: Some subroutines may suppress thought/action posting while still posting final results.

**Implementation**:
- Controlled by `suppressThoughtPosting` subroutine option
- Suppresses `thought` and `action` types only
- Does NOT suppress `response` or `error` activities
- Allows silent execution with only final results posted

---

## Tool Result Formatting

### Syntax Highlighting
- Applied by file type (typescript, python, javascript, etc.)
- Code blocks wrapped in appropriate language fences

### Content Processing
- Line numbers removed from Read output
- System reminder tags stripped
- Empty output shows `*No output*` or `*File written successfully*`
- Edit tool shows diff format

### Truncation
- Large outputs are truncated by the formatter
- Provides representative sample of output

---

## Multi-Runner Support

All activity creation methods detect and support multiple runner types:

| Runner | Session ID Field | Detection Method |
|--------|-----------------|------------------|
| ClaudeRunner | `claudeSessionId` | Default |
| GeminiRunner | `geminiSessionId` | `runner.constructor.name === "GeminiRunner"` |
| OpenCodeRunner | `opencodeSessionId` | `runner.constructor.name === "OpenCodeRunner"` |

---

## Implementation Reference

Key files involved in activity tracking:

- `packages/edge-worker/src/AgentSessionManager.ts` - Orchestrates activity posting
- `packages/edge-worker/src/formatter.ts` - Formats tool parameters and results
- `packages/claude-runner/src/ClaudeRunner.ts` - Claude SDK message handling
- `packages/opencode-runner/src/OpenCodeRunner.ts` - OpenCode SDK message handling
- `packages/gemini-runner/src/GeminiRunner.ts` - Gemini CLI message handling

### Key Methods in AgentSessionManager

| Method | Purpose | Lines |
|--------|---------|-------|
| `postModelNotificationThought()` | Post model notification | 1686-1715 |
| `postAnalyzingThought()` | Post instant acknowledgment | 1720-1753 |
| `postProcedureSelectionThought()` | Post procedure selection | 1758-1789 |
| `handleStatusMessage()` | Handle compacting status | 1794-1866 |
| `syncEntryToLinear()` | Route messages to activities | 959-1205 |
| `createThoughtActivity()` | Create thought activity | 1350-1384 |
| `createErrorActivity()` | Create error activity | 1479-1513 |
| `createApprovalElicitation()` | Create approval request | 1560-1602 |
