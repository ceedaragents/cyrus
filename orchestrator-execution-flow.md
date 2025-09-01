# Orchestrator Execution and Feedback Flow Diagram

This Mermaid diagram illustrates the execution and feedback flow sequence outlined in the orchestrator.md prompt.

```mermaid
sequenceDiagram
    participant O as Orchestrator Agent
    participant L as Linear (Issues)
    participant C as Child Agent
    participant W as Child Worktree
    participant R as Remote Repository

    Note over O: 1. Initialize Phase
    O->>R: Push local branch to remote
    O->>L: Analyze parent issue requirements
    O->>L: Check for existing sub-issues
    O->>O: Identify work type and dependencies

    Note over O: 2. Decompose Phase
    O->>L: Create sub-issue with structured template
    Note over O,L: Include: Clear title, Parent assignee inheritance,<br/>Structured description, Agent type labels,<br/>Mandatory verification requirements

    Note over O: 3. Execute Phase
    O->>L: Create agent session (mcp__cyrus-tools__linear_agent_session_create)
    O->>C: Trigger child agent session
    Note over O: HALT - Await completion notification
    C->>W: Create child worktree
    C->>W: Implement changes
    C->>W: Run local tests/verification
    C->>L: Post completion with verification instructions

    Note over O: 4. Evaluate Results (MANDATORY VERIFICATION)
    O->>C: Receive completion notification
    O->>W: Navigate to child worktree directory
    O->>W: Execute ALL verification commands
    W-->>O: Return verification results
    
    alt Verification Success
        Note over O: ALL verification steps passed
        O->>W: Execute: git merge child-branch
        O->>R: Push to remote: git push origin <branch>
        O->>L: Document verification results in parent issue
        Note over O: Check if more sub-issues needed
        alt More sub-issues required
            O->>O: Start next sub-issue (back to step 2)
        else All sub-issues complete
            O->>O: Move to Complete phase
        end
    else Verification Partial Success
        Note over O: Some verification steps failed
        O->>C: Provide feedback (mcp__cyrus-tools__linear_agent_give_feedback)
        Note over O: DO NOT merge - await fixes
        C->>W: Implement fixes
        C->>L: Update with new verification instructions
        Note over O: Loop back to verification
    else Verification Failed
        Note over O: Significant failures or missing verification
        O->>O: Analyze root cause
        alt Need Enhanced Instructions
            O->>L: Create revised sub-issue with enhanced requirements
        else Wrong Agent Type
            O->>L: Create new sub-issue with different agent label
        else Technical Blocker
            O->>L: Create unblocking issue
        end
        Note over O: Re-attempt with corrections
    end

    Note over O: 5. Complete Phase
    O->>L: Verify all sub-issues completed
    O->>O: Validate parent objectives achieved
    O->>L: Document final state and learnings
    O->>R: Create PR using gh pr create

    Note over O: Critical Feedback Loops
    Note over O,C: Verification-Merge Loop:<br/>Child Completes → Navigate to Worktree →<br/>Execute Verification → Compare Results →<br/>[PASS: Merge & Push] OR [FAIL: Feedback & Retry]

    Note over O,C: Error Recovery Loop:<br/>Agent Failure → Analyze Root Cause →<br/>Enhance/Add/Change/Unblock → Re-attempt

    Note over O,W: Quality Assurance Loop:<br/>Visual Verification (Screenshots MUST be read) →<br/>Evidence Documentation →<br/>Independent Validation Required
```

## Key Flow Characteristics

### Sequential Processing
- Work is **not parallel** - only one sub-issue active at a time
- Next session only triggered after successful merge of current issue

### Mandatory Verification Gates
1. **Pre-Merge Gate**: Verification commands must pass in child worktree
2. **Visual Confirmation Gate**: All screenshots must be read/viewed for UI changes
3. **Evidence Gate**: Documentation of verification results required
4. **Integration Gate**: Confirm no regressions introduced

### State Tracking
- **Completed**: (with verification results)
- **Active**: (currently executing)
- **Pending**: (queued)
- **Blocked**: (awaiting resolution)

### Critical Quality Controls
- **NO BLIND TRUST**: Never merge based solely on child agent completion claims
- **VERIFICATION IS NON-NEGOTIABLE**: Every sub-issue must be independently validated
- **EVIDENCE-BASED DECISIONS**: Merge only after documented verification success
- **VISUAL CONFIRMATION REQUIRED**: Screenshots must be taken AND read/viewed

The diagram emphasizes the orchestrator's role as a quality gate that ensures rigorous validation through independent execution rather than trusting agent completion claims.