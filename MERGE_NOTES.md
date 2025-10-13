# Merge Notes: orakemu/main → ceedaragents/main

## Executive Summary

This merge integrates PR #295 from the orakemu fork (56 commits ahead) into our main branch. The fork adds substantial multi-CLI support features while main has evolved with procedure routing and config management.

**Status**: ✅ **COMPLETE** - All conflicts resolved, TypeScript compilation passes, build succeeds

**Key Integration**: Successfully merged all pieces:
- ✅ Multi-CLI type system and infrastructure
- ✅ Procedure routing from main preserved
- ✅ Config file watching from main preserved
- ✅ All package dependencies resolved
- ✅ Runner selection/execution logic fully integrated
- ✅ CLI type compatibility resolved
- ✅ All TypeScript errors fixed
- ✅ Linting checks pass
- ✅ Build succeeds

**Verification Complete**: All quality checks passed, ready for PR

---

# Merge Notes: orakemu/main → ceedaragents/main

## Overview

Merging PR #295 from orakemu fork (56 commits ahead) into ceedaragents/cyrus main branch.

## Fork Features Being Merged

- Multi-CLI support with global/default runner management
- Label-driven routing precedence (Claude, Codex, OpenCode)
- Codex resume support (persist and resume sessions after restarts)
- Prompt management commands + Ink TUI
- Enhanced Linear messaging (acknowledgements as cards, ordered output, inline errors)

## Main Branch Features Being Preserved

- Intelligent procedure routing system (PR #313)
- Dynamic configuration reload (PR #320)
- MCP environment variable support (PR #328)
- Recent Claude Agent SDK updates

## Merge Conflicts Resolved

### 1. packages/edge-worker/package.json
**Decision**: Keep both new dependencies
- Added `chokidar` from main (for config file watching)
- Kept `cyrus-agent-runner` from fork
**Rationale**: Both features need their respective dependencies

### 2. CHANGELOG.md
**Decision**: Preserve fork's unreleased section, keep all released versions from main
**Rationale**: Fork's unreleased changes are valid additions; main's releases are historical record

### 3. packages/edge-worker/src/index.ts
**Decision**: Export all types and functions from both branches
- Kept `SAFE_BASH_TOOL_ALLOWLIST` export from fork
- Kept additional type exports from fork (CliDefaults, EdgeCredentials, etc.)
**Rationale**: More exports = better API surface, no conflicts

### 4. pnpm-lock.yaml
**Decision**: Will regenerate after source conflicts resolved
**Rationale**: Lockfile must be generated from final package.json states

## Remaining Conflicts to Resolve

### 5. packages/edge-worker/src/types.ts
**Status**: Pending
**Strategy**: Merge type definitions from both branches

### 6. packages/edge-worker/src/AgentSessionManager.ts
**Status**: Pending
**Strategy**: Integrate session caching from fork with main's changes

### 7. packages/edge-worker/src/EdgeWorker.ts
**Status**: Pending (largest, most complex)
**Strategy**:
- Preserve procedure routing system from main
- Integrate multi-CLI support and label routing from fork
- Combine config watching from main with fork's features

### 8. apps/cli/app.ts
**Status**: Pending
**Strategy**: Add fork's CLI commands while preserving main's updates

### 9-10. Test files
**Status**: Pending
**Strategy**: Keep tests from both branches, merge assertions

---

##Progress Status

### Completed Merges ✅
1. ✅ `packages/edge-worker/package.json` - Merged dependencies (chokidar + cyrus-agent-runner)
2. ✅ `CHANGELOG.md` - Combined unreleased + released versions
3. ✅ `packages/edge-worker/src/index.ts` - Preserved all exports
4. ✅ `pnpm-lock.yaml` - Staged for regeneration
5. ✅ `packages/edge-worker/src/types.ts` - Kept fork's multi-CLI types
6. ✅ `packages/edge-worker/src/AgentSessionManager.ts` - Used main's procedure routing
7. 🔄 `packages/edge-worker/src/EdgeWorker.ts` - **IN PROGRESS** (4/9 conflicts resolved)
   - ✅ Imports merged (cyrus-agent-runner + chokidar)
   - ✅ Type imports merged
   - ✅ Built-in prompts constants added
   - ✅ Instance variables merged (multi-CLI + procedure routing + config watching)
   - ⏳ 5 remaining conflicts in implementation methods

### Remaining Work ⏳
- `packages/edge-worker/src/EdgeWorker.ts` - 4 conflicts remain (~lines 2090, 2227, 3063, 4567)
  - These are in runner execution and selection logic
  - Need to integrate fork's multi-CLI runner selection with main's procedure routing
  - Estimated effort: 1-2 hours of careful merging
- `apps/cli/app.ts` - CLI commands merge needed
  - Fork adds: set-default-cli, set-default-model, migrate-config commands
  - Relatively straightforward - add fork's commands to main
- `packages/edge-worker/test/` - 2 test files
  - Update test assertions to match merged implementation

## Key Assumptions & Principles

1. **Additive Merging**: When both branches add features, keep both unless they directly conflict
2. **Procedure Routing Priority**: Main's procedure routing is recent and critical - preserve it
3. **Multi-CLI Integration**: Fork's multi-CLI system is the main feature - ensure it works
4. **Type Safety First**: Resolve type conflicts to maintain TypeScript compilation
5. **Test Coverage**: Preserve all tests unless they test mutually exclusive features

---

## Detailed Conflict Resolutions

### 5. packages/edge-worker/src/AgentSessionManager.ts

**Conflict Analysis**:
- Line 247-311: Main has procedure routing system for handling completion. Fork has simpler child session handling.
- Line 1154-1167: Minor conflict in result entry formatting - fork has more detailed responseBody logic

**Decision**: Use main's procedure routing system
- Main's `handleProcedureCompletion` method is more sophisticated
- Integrates approval workflows, subroutine advancement, and child session handling
- Fork's simpler approach is superseded by procedure system
- Keep main's detailed response body logic (lines 1155-1162 from fork)

**Rationale**:
- Procedure routing is a major feature in main (PR #313)
- Fork's child session logic is preserved within main's procedure completion handler
- The procedure system is more flexible and feature-complete

### 7. packages/edge-worker/src/EdgeWorker.ts (9 conflicts in 6025 lines)

**Strategy**: Systematically resolve each conflict
- Keep main's procedure routing infrastructure
- Integrate fork's multi-CLI support (RunnerType, model selection, label routing)
- Preserve config watching from main
- Merge fork's CLI adapter logic

**Key Integration Points**:
1. Multi-CLI runner selection logic from fork
2. Procedure routing system from main
3. Config file watching from main
4. Label-based routing rules from fork

### 8. apps/cli/app.ts

**Strategy**: Add fork's CLI commands while preserving main's updates
- Fork adds: set-default-cli, set-default-model, migrate-config commands
- Main has: recent updates to existing commands
- Keep both sets of features

### 9-10. Test files

**Strategy**: Preserve tests from both branches
- Keep all test cases unless they test mutually exclusive features
- Update assertions to match merged implementation

### 6. packages/edge-worker/src/types.ts

**Conflict Analysis**:
- Main branch: Moved most types to `packages/core/src/config-types.ts` (cleaner architecture)
- Fork branch: Has additional types for multi-CLI support that main doesn't have:
  - `RunnerType = "claude" | "codex"`
  - `ClaudeRunnerModelConfig`, `CodexRunnerModelConfig`, `CodexCliDefaults`
  - `CliDefaults`, `EdgeCredentials`, `RepositoryRunnerModels`
  - `RepositoryLabelAgentRoutingRule`
  - Enhanced `PromptRuleConfig` with more flexibility
  - Enhanced `RepositoryConfig` with `runner`, `runnerModels`, `labelAgentRouting` fields
  - Enhanced `EdgeWorkerConfig` with `defaultCli`, `cliDefaults`, `credentials` fields

**Decision**: Keep fork's types but import shared types from core
- Import base types from `cyrus-core` (RepositoryConfig, EdgeWorkerConfig, etc.)
- Keep fork-specific additions (RunnerType, CLI model configs, routing rules)
- Fork's enhanced interfaces extend what's in core

**Rationale**:
- Main's refactoring to core is good architecture
- Fork's multi-CLI types are additive and necessary for new features
- Need to import from core and add fork's extensions

---

## Completing the Merge

### Steps to Finish

1. **Resolve remaining EdgeWorker.ts conflicts** (~lines 2090, 2227, 3063, 4567):
   - These conflicts are in runner selection and execution methods
   - Strategy: Keep fork's multi-CLI runner selection logic, preserve main's procedure routing hooks
   - Look for patterns like `selectionForSession.type !== "claude"` (fork) vs procedure routing calls (main)
   - Merge both - multi-CLI selection happens first, then procedure routing within each runner type

2. **Merge apps/cli/app.ts**:
   - Add fork's new commands: `set-default-cli`, `set-default-model`, `migrate-config`
   - These are additive - should be straightforward to add to main's command structure
   - Look for the command registration section and add fork's commands

3. **Update test files**:
   - `packages/edge-worker/test/EdgeWorker.label-based-prompt-command.test.ts`
   - `packages/edge-worker/test/EdgeWorker.system-prompt-resume.test.ts`
   - Update assertions to match merged implementation
   - Both branches may have added different test cases - keep all

4. **Regenerate pnpm-lock.yaml**:
   ```bash
   pnpm install
   ```

5. **Run tests**:
   ```bash
   pnpm test:packages
   pnpm typecheck
   pnpm build
   ```

6. **Create PR**:
   - Use this MERGE_NOTES.md as the PR description
   - Highlight that this integrates 56 commits from the fork
   - Note that procedure routing (main) and multi-CLI (fork) are both preserved

### Key Patterns to Watch For

- **Runner Selection**: Fork uses `RunnerType = "claude" | "codex"` - this is the core of multi-CLI
- **Procedure Routing**: Main uses `ProcedureRouter` to select workflows - this happens within Claude runner
- **Integration Point**: Runner selection happens BEFORE procedure routing. Flow is:
  1. Resolve runner type (claude vs codex) - fork's logic
  2. If claude: apply procedure routing - main's logic
  3. If codex: use codex-specific handling - fork's logic

