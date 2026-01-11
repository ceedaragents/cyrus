# CYPACK-705 Investigation Findings

## Summary

After deep analysis of the production logs from CYGROW-342, the root cause has been identified: **Claude ended Session 1 prematurely after AskUserQuestion by providing a text summary instead of continuing to write the blog post.** This caused an unexpected subroutine transition, leaving Claude with "incomplete work" context that it tried to continue in Session 3.

## Root Cause Analysis (New Finding)

### The Chain of Events

**Session 1** (`d61a8e3e-...`, 18:58:10 - 19:08:18):
1. Claude invoked `/seo-blog-post-research` skill
2. Claude conducted SEO research (Ahrefs, web searches, etc.)
3. Claude called `AskUserQuestion` to get approval for the blog plan (19:04:43)
4. **4 minutes later**, user responded: "yes I approve. but the title is too long" (19:08:09)
5. **Claude responded with a TEXT SUMMARY only** - no tool calls:
   > "The user approves but wants a shorter title... My SEO research is complete. Here's the summary..."
6. Session ended with `"subtype":"success"` after 43 turns

**Why Session 1 Ended Prematurely**:
- Claude interpreted the user's approval as the **end of the research phase**
- Instead of proceeding to write the blog post, Claude summarized the research and stopped
- The SDK saw Claude end with text (no pending tool calls) → marked session as `success`
- This triggered `handleProcedureCompletion` → advanced to next subroutine (`gitCommit`)

**Session 2** (`d61a8e3e-...`, 19:08:20 - 19:10:54):
1. Session started with the **`gitCommit` subroutine prompt** (the next after `primary`)
2. But Claude **ignored the subroutine prompt** and continued its previous mental state
3. Claude's first action: `TodoWrite` with pending tasks:
   - "Write the blog post" (in_progress)
   - "Generate hero image" (pending)
   - "Run vercel build" (pending)
   - "Commit and create PR" (pending)
4. Claude wrote the blog post, then invoked `/abstract-narrative-image-prompting` skill
5. Skill completed at 19:10:54, session ended with `success`
6. This triggered advancement to `concise-summary` subroutine

**Session 3** (`d61a8e3e-...`, 19:11:03 - 19:11:17):
1. `concise-summary` prompt injected as `<new_comment>`
2. Claude **ignored the summary prompt**, continued with previous context:
   > "I have the image prompt ready. Now let me generate the hero image..."
3. Claude called `TodoWrite` updating blog post tasks
4. **Hit `error_max_turns`** (configured for 2 turns for `concise-summary`)

### The Core Problem

**Claude's context persistence across sessions caused it to ignore subroutine prompts.**

When Session 1 ended prematurely (after Claude gave a research summary instead of continuing work), the procedure advanced to `gitCommit`. But Session 2 was a **continuation** of the same Claude session (`--continue` flag), so Claude retained its previous mental state of "I need to write the blog post."

This created a mismatch:
- **Procedure state**: gitCommit → ghPr → conciseSummary
- **Claude's mental state**: "I need to write the blog post, generate image, run build, commit"

Claude followed its own context, not the subroutine prompts.

## Why Session 1 Ended Early (Critical Finding)

The key question was: **Why did Claude end Session 1 after AskUserQuestion despite having pending todos?**

### The Todo State at Session End

The **last TodoWrite** in Session 1 showed:
```
- "Conduct SEO research..." - in_progress
- "Write the blog post..." - pending
- "Generate hero image..." - pending
- "Run vercel build..." - pending
```

**Claude had 3 pending tasks** but still chose to end the session.

### What Happened

Analysis of the JSONL reveals:
1. At 19:04:43, Claude called `AskUserQuestion` requesting approval
2. At 19:08:09, user responded: "yes I approve. but the title is too long"
3. At 19:08:18, Claude responded with **TEXT ONLY** (no tool calls):
   - "My SEO research is complete. Here's the summary..."
   - Listed the blog post structure as a plan
   - **Did not call TodoWrite to update tasks**
   - **Did not invoke any tool to continue working**

### Why This Is a Model Behavior Issue

Claude's response was a **terminal text response** - it ended by outputting text without calling any tools. The Claude Agent SDK correctly interprets this as "Claude is done with its work."

But Claude **chose** to end with a summary instead of:
1. Updating todos to mark "SEO research" as complete
2. Moving to the next task: "Write the blog post"
3. Calling tools to continue the work

This is a fundamental model behavior issue: **Claude treated the user's approval as the end of a research phase rather than a trigger to continue with pending work.**

The phrase "My SEO research is complete" signaled to the SDK that the session was finished, despite Claude having an explicit list of pending todos that it created itself.

## Documentation-Edit Procedure Issue

The `documentation-edit` procedure has this structure:
```
subroutines: [
  primary,        ← No prompt file, main work phase
  gitCommit,
  ghPr,
  conciseSummary
]
```

The `primary` subroutine is a placeholder with no explicit prompt. When Session 1 "completed", the procedure advanced to `gitCommit`, but Claude was still mentally in the "writing the blog" phase.

## Previous Reproduction Attempts

Earlier F1 test attempts could not reproduce this because:
1. **Different classification**: F1 tests classified as `simple-question` not `documentation-edit`
2. **No skill invocation**: Tests didn't trigger `/seo-blog-post-research` skill
3. **Simpler context**: Test sessions had much smaller context than the 145+ message original
4. **Missing attachments**: Original had 4 images/transcripts affecting task complexity

## Recommendations

### 1. Detect Premature Session Completion with Pending Todos

The system should detect when Claude ends a session with pending/in_progress todos and take action:

**Option A: Inject a continuation prompt**
When the SDK receives a "success" result but the session has pending todos:
- Automatically inject a follow-up prompt: "You still have pending tasks in your todo list. Please continue with: [next pending task]"
- This would trigger a new turn before the session truly ends

**Option B: Block session completion**
- Modify the ClaudeRunner or SDK wrapper to intercept the "success" result
- If pending todos exist, convert it to a continuation rather than completion
- Re-prompt Claude with its own todo list

**Option C: System prompt enhancement**
Add explicit instructions in the system prompt:
- "Never end a session with pending todos unless explicitly told to stop"
- "After AskUserQuestion approval, immediately continue to the next pending task"
- "Always call TodoWrite to update task status before ending a session"

### 2. Stronger Subroutine Markers

The current `<new_comment>` wrapper for subroutine prompts is treated like regular user input. Consider:
- Using a distinct `<subroutine_directive>` XML tag
- Adding explicit "STOP your current work" instructions
- Clearing or acknowledging existing todos at subroutine boundaries

### 3. Context Boundary Management

When a subroutine completes and transitions to the next:
- Log Claude's active TodoWrite state
- Warn if there are pending/in_progress todos when a subroutine "completes"
- Consider starting a fresh session (new session ID) for major subroutine transitions

### 4. Procedure Design

The `primary` subroutine being a placeholder with no prompt may contribute to confusion. Consider:
- Making `primary` more explicit about what "completion" means
- Adding intermediate checkpoints for multi-phase work (research → writing → verification)

## Session Log Locations

| Log Type | Path |
|----------|------|
| Session 1 readable | `~/.cyrus/logs/CYGROW-342/session-d61a8e3e-...-2026-01-10T18-58-15-088Z.md` |
| Session 1 JSONL | `~/.cyrus/logs/CYGROW-342/session-d61a8e3e-...-2026-01-10T18-58-15-088Z.jsonl` |
| Session 2 readable | `~/.cyrus/logs/CYGROW-342/session-d61a8e3e-...-2026-01-10T19-08-25-226Z.md` |
| Session 2 JSONL | `~/.cyrus/logs/CYGROW-342/session-d61a8e3e-...-2026-01-10T19-08-25-226Z.jsonl` |
| Session 3 JSONL | `~/.cyrus/logs/CYGROW-342/session-d61a8e3e-...-2026-01-10T19-11-03-020Z.jsonl` |

## Conclusion

The bug occurred because:
1. Claude ended Session 1 early after AskUserQuestion (model behavior issue)
2. The procedure advanced to `gitCommit` subroutine
3. But Claude's context (via `--continue`) still contained "incomplete work"
4. Claude ignored subsequent subroutine prompts and followed its own mental state
5. This led to the `error_max_turns` in Session 3

The fix requires addressing the mismatch between procedure state and Claude's persisted context across continued sessions.
