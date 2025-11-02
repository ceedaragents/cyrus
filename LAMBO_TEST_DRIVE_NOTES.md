# 🏎️ Lambo Test Drive - UX Notes

**Date**: 2025-11-02
**Objective**: Take Lambo for a real development test drive and document UX issues/improvements

## Test Drive Objective

**Real Development Task**: Create a simple feature to add color-coded activity types in `viewSession` output to make it easier to scan for different types of activities (thought, action, tool_use, etc.)

This will test:
- Creating issues
- Starting sessions
- Viewing activities
- Using the new features (--full, --preview-length, getActivity)
- Prompting sessions
- Overall workflow

---

## Test Drive Log

### Starting Up

**Command**: `export CYRUS_PORT=3458 && node tools/cli-platform/start-lambo.mjs`

**UX Notes**:
- ✅ Beautiful startup banner with colored output
- ✅ Clear indication of what's loading
- ✅ Port and endpoint information displayed
- ⚠️ **Issue**: No indication if port is already in use until failure
- 💡 **Improvement**: Add port availability check before starting

---

### Creating an Issue

**Command**: `./lambo createIssue --title "Add color-coded activity types" --description "Color code different activity types in viewSession for easier scanning"`

**UX Notes**:
- ✅ Clean, formatted JSON output with colors
- ✅ Values display correctly (printJSON bug fixed!)
- ✅ All relevant fields shown
- ⚠️ **Issue**: Issue ID not immediately obvious - buried in output
- 💡 **Improvement**: Highlight the issue ID prominently, maybe:
  ```
  ✅ Issue Created: CLI-1

  { ... rest of details ... }
  ```

---

### Starting a Session

**Command**: `./lambo startSession --issue-id issue-1`

**UX Notes**:
- ✅ Returns session ID clearly
- ⚠️ **Issue**: No indication that session has started processing
- ⚠️ **Issue**: User doesn't know what to do next
- 💡 **Improvement**: Add helpful next-step hint:
  ```
  ✅ Session Started: session-1

  💡 Next steps:
     • View progress: lambo viewSession --session-id session-1
     • Send message: lambo promptSession --session-id session-1 --message "..."
  ```

---

###  Viewing Session Activities

**Command**: `./lambo viewSession --session-id session-1`

**UX Notes**:
- ✅ Session metadata displayed clearly
- ✅ Activities sorted by most recent first
- ✅ Activity preview truncation working (200 chars default)
- ⚠️ **Issue**: All activities look the same - hard to scan
- ⚠️ **Issue**: Activity IDs (activity-1, activity-2) not easy to copy
- 💡 **Improvement**: Color-code activity types:
  - 💭 Blue for "thought"
  - ⚡ Yellow for "action"
  - 🔧 Green for "tool_use"
  - ❌ Red for "error"
- 💡 **Improvement**: Add hint for copying activity IDs

---

### Testing --full Flag

**Command**: `./lambo viewSession --session-id session-1 --full`

**UX Notes**:
- ✅ Shows complete activity bodies without truncation
- ✅ Works as expected
- ⚠️ **Issue**: With long activities, output becomes overwhelming
- ⚠️ **Issue**: No visual separator between activities
- 💡 **Improvement**: Add horizontal separator between activities in --full mode
- 💡 **Improvement**: Add line count indicator for long activities

---

### Testing --preview-length

**Command**: `./lambo viewSession --session-id session-1 --preview-length 50`

**UX Notes**:
- ✅ Truncates to specified length
- ✅ Works as expected
- ⚠️ **Issue**: No indication that content is truncated beyond "..."
- 💡 **Improvement**: Show total character count:
  ```
  Some preview text... (124 more chars)
  💡 Tip: Use --full to see complete content or --preview-length 300
  ```

---

### Testing getActivity

**Command**: `./lambo getActivity --session-id session-1 --activity-id activity-3`

**UX Notes**:
- ✅ Shows full activity details
- ✅ Body displayed with proper indentation
- ✅ Metadata (type, created, signal) clearly shown
- ⚠️ **Issue**: No easy way to know activity IDs without viewing session first
- ⚠️ **Issue**: No indication of activity position in sequence
- 💡 **Improvement**: Add activity number in sequence:
  ```
  ✅ Activity Details (3 of 15)
  ```
- 💡 **Improvement**: Add navigation hints:
  ```
  💡 Navigation:
     • Previous: activity-2
     • Next: activity-4
  ```

---

### Workflow Observations

**Overall Flow**: Create issue → Start session → View session → Prompt/Get details

**UX Gaps Identified**:

1. **No Status Indication**: User doesn't know if session is actively processing or idle
   - 💡 Add status badges: 🟢 Active | 🟡 Waiting | 🔴 Stopped | ⚪ Pending

2. **No Activity Count Preview**: When viewing session, don't know total before loading
   - 💡 Show count in session header: "Activities: 15 total (showing 10)"

3. **No Time Context**: Hard to know how old activities are
   - 💡 Add relative time: "2 minutes ago" instead of just timestamp

4. **No Search Highlighting**: When using --search, matching terms not highlighted
   - 💡 Highlight search terms in yellow/bold

5. **No Activity Type Filter**: Can only search by text, not by activity type
   - 💡 Add --type filter: `--type thought` or `--type tool_use`

6. **Command Discovery**: New users might not know all available commands
   - ✅ Help is good, but could add "Did you know?" tips in output

---

## Priority Improvements

### High Priority (Implement Now)
1. Color-coded activity types (original test objective!)
2. Improved createIssue output with prominent issue ID
3. Better startSession output with next-step hints
4. Status badges for session status

### Medium Priority
5. Activity separators in --full mode
6. Relative timestamps ("2 min ago")
7. Search term highlighting
8. Activity type filter (--type)

### Low Priority (Nice to Have)
9. Navigation hints in getActivity
10. Activity position indicator
11. "Did you know?" tips
12. Port availability check on startup

---

## Next Step

Implement the HIGH PRIORITY improvements!
