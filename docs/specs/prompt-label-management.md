# Prompt & Label Management Spec

## Background

Operators need hands-on control over how Linear labels map to agent prompts and
runner selections. Today the configuration lives inside `~/.cyrus/config.json`
and is edited manually. We want first-class CLI support so users can inspect,
create, update, or delete these mappings safely, and bootstrap sensible global
defaults for CLI routing.

## Goals

1. List existing label→prompt associations and the prompt assets backing them.
2. Edit label lists for any prompt template (built-in or custom).
3. Scaffold entirely new prompt templates (name + markdown body) and tie labels
   to them.
4. Delete custom templates and detach their labels.
5. Provide a helper command to seed global label routing so well-known labels
   (`codex`, `cli-codex`, `claude`, `cli-claude`, `opencode`, `cli-opencode`) map
   to the matching runner without specifying models.

## Non-Goals

- Changing the underlying prompt text for the four built-in templates (debugger,
  builder, scoper, orchestrator).
- Altering how prompts are rendered inside the edge-worker beyond wiring in the
  data edits performed by the CLI.
- Managing team-specific Linear label creation (still done in Linear).

## Multi-Surface Prompt Management Roadmap

Prompt management will be delivered across both traditional CLI commands and a
new Ink-based terminal UI (TUI). The TUI must work smoothly over SSH on VPS
deployments and will become the preferred experience once editing capabilities
ship.

### Phase 1 – Listing (Complete)

- `cyrus prompts list` exposes repositories, label bindings, prompt origins, and
  prompt content in both human and JSON formats.
- Shared helpers normalize label arrays, dedupe definitions, and load built-in
  markdown from `packages/edge-worker/prompts/`.

### Phase 2 – TUI Foundation (Current Focus)

- Deliver `cyrus prompts tui`, a curses-style interface using Ink.
- Core expectations:
  - Repository navigation pane with arrow-key support and `/`-powered search.
  - Prompt list pane showing type badges (built-in/custom) and label counts.
  - Scrollable preview pane for long prompt bodies with PgUp/PgDn/Home/End.
  - Global prompt definitions rendered once; per-repo view references shared
    definitions to avoid repetition.
  - Action footer listing active key bindings (e.g., `q Quit`, `/ Search`, `o
    Open in pager`).
  - `o` triggers `$PAGER` fallback by writing prompt content to a temp file.
  - Graceful handling of terminal resize and lack of mouse reporting.

### Phase 3 – Prompt CRUD (CLI + TUI Parity)

- Implement create/edit/delete commands and mirror the functionality inside the
  TUI via modal dialogs.
- All config writes must:
  - Back up `config.json` to `config.json.YYYYMMDDHHmm` before mutation.
  - Validate labels (no duplicates unless user confirms; warn on overlap across
    prompt types).
  - Prevent destructive operations on built-in prompt files (label updates only).
  - Provide dry-run and JSON output options for automation.

### Phase 4 – UX Enhancements

- Add linting for custom prompt markdown (e.g., check required XML tags).
- Surface warnings for label conflicts directly inside the TUI (badge + tooltip
  view).
- Offer export/import helpers for prompt collections.
- Document automation patterns for CI/GitOps once editing is stable.

## CLI Command Reference (Phase 3 Target)

| Command | Description |
| --- | --- |
| `cyrus prompts list [--repo <id>] [--json]` | Enumerate prompt mappings, showing prompt content and definition scope. |
| `cyrus prompts create <name> --labels <list> [--from template\|file] [--repo <id>]` | Scaffold a new prompt markdown file (under `packages/edge-worker/prompts/`) and register it. |
| `cyrus prompts edit <prompt> --labels <list> [--repo <id>] [--prompt-file <path>]` | Update labels and optionally replace markdown content; built-ins accept label edits only. |
| `cyrus prompts delete <prompt> [--repo <id>]` | Remove a custom prompt mapping and its file after double confirmation; rejects built-ins. |

Common flags:
- `--repo <id>`: limit operation to a single repository.
- `--all`: apply to every repository (where safe).
- `--json`: emit machine-readable output matching the inventory format.
- `--dry-run`: simulate changes without persisting.
- `--yes`: skip interactive confirmation (still requires backup).

## TUI Functional Specification

The TUI will consist of modular Ink components so junior developers can extend
features easily.

1. **App Shell**
   - Loads prompt inventory, stores it in context, and renders layout.
   - Shows global status bar with repo, prompt, dirty state, and hints.

2. **Initial View Selection**
   - On launch, prompt the operator to choose between viewing global prompts or
     repository-specific prompts (only repositories with custom prompt configs
     appear in the list).
   - If multiple repositories qualify, open a second selector to pick the target
     repo before rendering prompts.
   - Provide `Esc`/`b` shortcuts to navigate back to previous menus.

3. **Prompt List Pane (left)**
   - Single vertical list of prompts for the current context (global or chosen
     repo). Arrow keys move selection; `/` opens a filter input that matches
     prompt names or labels.
   - Rows show badges (`[B]` built-in, `[C]` custom) and label counts. The list
     must include scroll indicators when content exceeds the viewport.

4. **Preview Pane (right)**
   - Renders the selected prompt with minimal formatting and supports PgUp/PgDn
     chunking, `o` to open in `$PAGER`, and `w` to write the content to a temp
     file for copy/paste.
   - Hitting `Enter` or `v` opens a full-width view dedicated to copying the
     entire prompt body; `Esc`/`b` returns to the two-column layout.

5. **Action Footer**
   - Persistent key binding row: `[c] Create`, `[e] Edit labels`, `[E] Edit
     content`, `[d] Delete`, `[Enter] Full view`, `[o] Pager`, `[w] Write file`,
     `[r] Reload`, `[/] Search`, `[b] Back`, `[q] Quit`, `[?] Help`.
   - Each binding maps to centralized handlers so future editing forms can reuse
     them.

5. **Modals & Forms**
   - Create/edit/delete flows appear as centered modals with:
     - Title, brief instructions, input fields (Ink text inputs / select inputs).
     - Inline validation errors (e.g., “Prompt name is required”).
     - Buttons simulated via highlighted text segments (`[Enter] Confirm`,
       `[Esc] Cancel`).
   - Editing content offers two modes: inline multi-line editor (basic) or
     external `$EDITOR`; users choose via initial modal selection.

6. **State & Persistence**
   - All writes go through a shared persistence helper used by both CLI and TUI.
   - After successful write, reload inventory and display success toast.
   - On failure, show error toast with message and fallback instructions.

7. **Tests & Tooling**
   - Unit test data helpers and modal validation.
   - Use `ink-testing-library` to snapshot the TUI and simulate navigation.
   - Document development workflow (`pnpm --filter cyrus-ai dev:tui` or similar)
     for rapid iteration.

## Developer Notes & Documentation

- Update this spec as each phase completes and link to implementation PRs.
- Add screenshots/ASCII diagrams for the TUI once ready.
- Expand operational docs (`docs/agents.md`, tutorials) with launch commands,
  prerequisites (e.g., `$EDITOR` env var), and troubleshooting tips.
- Keep the plan junior-developer friendly by referencing shared utilities and
  coding patterns (e.g., how to add a new modal, where to place unit tests).

### Routing Helper

`cyrus labels init-default-routing [--repo <id>] [--force]`

- Seeds (or replaces if `--force`) each target repository’s `labelAgentRouting`
  with three rules: codex/cli-codex → Codex, opencode/cli-opencode → OpenCode,
  claude/cli-claude → Claude.
- Leaves `model`/`provider` empty so runner defaults apply.
- No changes when rules already match unless `--force`.

## Data Model Touch Points

- `RepositoryConfig.labelPrompts` (existing) – update label arrays or
  insert/delete entries.
- `packages/edge-worker/prompts/*.md` – new custom templates stored alongside
  built-ins.
- `RepositoryConfig.labelAgentRouting` – seeded by the helper command.

## Implementation Notes

- CLI edits should reuse the same JSON loader/writer edge-worker already uses to
  avoid schema drift.
- When creating templates, ensure filesystem paths are sanitized (kebab-case) and
  update TypeScript types if we support arbitrary names (export union updates).
- After config writes, prompt the operator to restart the edge-worker (or send a
  reload signal if we add one later).
- Add unit tests covering CLI command parsing plus edge-worker integration tests
  to confirm a custom prompt file is picked up during session start.

## Telemetry / Logging

- CLI should print human-readable summaries and support `--json` for automation.
- EdgeWorker already logs `Runner selection` and `Using X system prompt` – ensure
  new commands don’t silence that.

## Open Questions

- Should custom prompts support tool overrides (`allowedTools` /
  `disallowedTools`)? Assume yes; CLI scaffolder should accept optional flags.
- Do we need per-repo vs global prompt definitions? For now, manipulate repo
  configs individually; future work could add shared templates.

## Handoff Prompt for Implementation

```
You are continuing the "Prompt & Label Management" feature for Cyrus.

Deliverables:
1. Implement the CLI commands described in docs/specs/prompt-label-management.md.
2. Ensure edits update ~/.cyrus/config.json safely with backups.
3. Scaffold custom prompt markdown files alongside existing prompts.
4. Add unit/integration tests validating CLI command behavior and edge-worker consumption.
5. Update docs/tutorials/cyrus-label-routing-guide.md and docs/agents.md if CLI flags or flows change.

Constraints:
- TypeScript project (NodeNext). Existing packages use pnpm.
- Favor minimal dependencies; reuse existing config helpers.
- Keep formatting/ASCII rules from repository guidelines.

Before coding, read docs/specs/prompt-label-management.md to understand context.
Run pnpm --filter cyrus-agent-runner test:run and pnpm --filter cyrus-edge-worker test:run after changes.
```
