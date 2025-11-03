# Lambo UX Improvement Ideas

Based on Test Drive #001 - Rate Limiter Feature Development

## High Priority (Quick Wins)

### 1. Better Activity Previews
**Current**: Truncated JSON makes it hard to see what's happening
```
⚡ action
Write: {
  "file_path": "/private/var/folders/xv/c55x22nd...
```

**Proposed**: Show human-readable summaries
```
⚡ action
Write: src/rate-limiter.ts (245 lines)
```

**Implementation**: Extract key fields from action content and format nicely.

---

### 2. Dynamic Status Field
**Current**: Always shows "⚪ pending" even when actively working

**Proposed**: Reflect actual work state
- `⚪ Pending` - Session created but not started
- `⚙️ Working` - Agent actively processing
- `⏸️ Waiting` - Waiting for user input
- `✅ Complete` - All tasks done
- `🛑 Stopped` - Manually stopped
- `❌ Failed` - Error occurred

**Implementation**: Update status based on recent activity types and timing.

---

### 3. Message Feedback
**Current**: Sending messages feels like "shouting into void"

**Proposed**: Immediate acknowledgment
```bash
$ lambo.mjs promptSession --session-id session-2 --message "Add tests"
✅ Message queued for agent
   The agent will process this on the next iteration.
```

**Implementation**: Return friendly confirmation message.

---

### 4. Session Stop Summary
**Current**: Abrupt stop with just activity JSON

**Proposed**: Rich summary on stop
```
✅ Session Stopped

   Duration: 1m 34s
   Activities: 37 total
   Files modified: 5
   Status: Complete
   
   Next steps:
   • Review changes: lambo files --session-id session-2
   • Export session: lambo export --session-id session-2
```

**Implementation**: Calculate stats from session data and format nicely.

---

## Medium Priority (More Complex)

### 5. Real-Time Tail Mode
**Proposed**: Watch session activity in real-time
```bash
$ lambo.mjs tail --session-id session-2

📡 Watching session-2 (Ctrl+C to stop)

⚙️ Working...

[08:05:23] 💭 Perfect! I'll use TypeScript and Jest...
[08:05:28] ⚡ Write: src/rate-limiter.ts
[08:05:31] ⚡ Write: src/rate-limiter.test.ts
[08:05:34] ⚡ Write: package.json
[08:05:39] 💭 Running tests...
```

**Implementation**: Poll viewSession every 1-2 seconds, show new activities only.

---

### 6. File Browser
**Proposed**: See all files modified in a session
```bash
$ lambo.mjs files --session-id session-2

📁 Files Modified (5)

✏️  src/rate-limiter.ts          245 lines
✏️  src/rate-limiter.test.ts     187 lines
✏️  package.json                  3 lines added
📄 README.md                     12 lines added
📄 tsconfig.json                 New file
```

**Implementation**: Parse Write activities and aggregate file operations.

---

### 7. Activity Type Filtering
**Proposed**: Filter activities by type
```bash
$ lambo.mjs viewSession --session-id session-2 --type action
# Shows only actions (Write, Read, Bash, etc.)

$ lambo.mjs viewSession --session-id session-2 --type thought
# Shows only agent's reasoning
```

**Implementation**: Add type parameter to RPC endpoint, filter in service.

---

### 8. Progress Indicators
**Proposed**: Show overall completion
```
Agent Session
   Status: ⚙️ Working (Step 3 of 5 - 60% complete)
```

**Implementation**: 
- Parse checklists from thoughts
- Calculate completion ratio
- Show in session header

---

## Low Priority (Nice to Have)

### 9. Export Session
**Proposed**: Export session to markdown
```bash
$ lambo.mjs export --session-id session-2 --format markdown > session.md
```

**Implementation**: Format activities as readable markdown.

---

### 10. Compact Mode
**Proposed**: Less verbose output option
```bash
$ lambo.mjs createIssue --title "..." --compact
✅ Created: CLI-5 (issue-5)
```

**Implementation**: Add --compact flag to suppress JSON output.

---

### 11. Session Templates
**Proposed**: Pre-configured session types
```bash
$ lambo.mjs startSession --issue-id issue-1 --template feature
# Uses "feature development" template with specific prompts

$ lambo.mjs startSession --issue-id issue-2 --template bugfix
# Uses "bug fix" template optimized for debugging
```

**Implementation**: Store templates as configs, inject into session start.

---

### 12. Activity Annotations
**Proposed**: Add notes to activities
```bash
$ lambo.mjs annotate --session-id session-2 --activity-id activity-20 \
  --note "This implementation looks great!"
```

**Implementation**: Store annotations in activity metadata.

---

## Implementation Roadmap

**Phase 1** (Quick Wins):
- Better activity previews
- Dynamic status field
- Message feedback
- Session stop summary

**Phase 2** (Enhanced Monitoring):
- Real-time tail mode
- File browser
- Activity type filtering

**Phase 3** (Power Features):
- Progress indicators
- Export functionality
- Session templates
- Compact mode

---

## Design Principles

Based on test drive learnings:

1. **Progressive Disclosure** - Show essentials first, details on demand
2. **Immediate Feedback** - Confirm every action with clear output
3. **Human-Readable** - Prefer summaries over raw data
4. **Guided Experience** - Suggest next steps at every stage
5. **Visual Hierarchy** - Use colors/emojis to aid scanning
6. **Error Recovery** - Make mistakes obvious and fixable

---

**Updated**: 2025-11-03  
**Based On**: Test Drive #001
