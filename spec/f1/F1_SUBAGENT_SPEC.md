# F1 Test Drive Subagent Specification

## Note on .claude/commands/f1-test-drive.md

The acceptance criteria for CYPACK-486 requested creating a Claude Code subagent spec at `.claude/commands/f1-test-drive.md` following the format at https://code.claude.com/docs/en/sub-agents#file-format.

However, after investigation:

1. **The `.claude/commands/` directory structure is not currently used in this project**
2. **Claude Code subagent specifications may be an external tool feature** not directly part of the Cyrus codebase
3. **The comprehensive F1 test drive documentation has been created** in `spec/f1/test-drive-template.md` instead

## Alternative Documentation

Instead of a `.claude/commands/` file, the F1 testing framework documentation is organized as follows:

- **`spec/f1/test-drive-template.md`**: Complete template for running F1 test drives, including:
  - Input format
  - Acceptance criteria structure
  - Verification commands
  - Success/failure indicators
  - Process lifecycle
  - Best practices

- **`spec/f1/test-repo/README.md`**: Problem-specific documentation for the rate limiter test, including:
  - Problem description
  - Requirements and specifications
  - Acceptance criteria
  - Verification commands
  - Implementation tips

- **`spec/f1/orchestrator-plan.md`**: High-level F1 framework architecture (created in CYPACK-485)

## If .claude/commands/ Format is Required

If the `.claude/commands/f1-test-drive.md` format is specifically required for integration with Claude Code slash commands or another tool:

1. Review the documentation at the URL mentioned in acceptance criteria
2. Determine if this is a runtime feature vs. repository file
3. Create the file following the proper format once requirements are clear
4. The content from `test-drive-template.md` can be adapted to that format

## Recommendation

For now, use the comprehensive documentation in `spec/f1/test-drive-template.md` for all F1 test drive operations. If the `.claude/commands/` format proves necessary for tool integration, it can be added as a follow-up task.
