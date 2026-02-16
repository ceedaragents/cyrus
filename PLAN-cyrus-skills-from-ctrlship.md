# Plan: Cyrus Skills from Mateusz "ctrlship" Article

**Issue**: CYPACK-811
**Source**: [ctrlship.dev](https://ctrlship.dev) by Mateusz Dembek (Principal Product Designer, Redbrick)
**Date**: 2026-02-16

---

## Executive Summary

Mateusz Dembek's ctrlship blog documents his experience as a non-developer using Claude Code to ship real products. His key innovation is a **4-agent design team** (Brand, UX, Visual, UI agents) that collaboratively produce design specifications before any code is written. Beyond the agents themselves, the blog reveals several actionable patterns around prompting, project planning, and iterative development that can be translated into Cyrus skills and procedures.

This plan proposes **5 new skills/agents** and **1 new procedure** for Cyrus, prioritized by impact.

---

## Article Analysis

### What ctrlship Describes

1. **Design Agent System** (most relevant): Four specialized agents (`Brand`, `UX`, `Visual`, `UI`) installed as markdown files in `~/.claude/agents/` that collaborate to produce a `BRIEF.md` design specification before coding begins. Workflow: Brand Discovery -> Parallel UX/Brand -> Visual Direction -> UI Component Spec -> Build.

2. **AI Communication Patterns**: Concrete prompting techniques — avoid vagueness, work incrementally (one feature at a time), use visual references (screenshots/URLs), provide project context, iterate until satisfied.

3. **Technology Selection Framework**: A decision tree for choosing tech stacks (static HTML vs React/Next.js vs Astro vs native) based on project requirements, with the insight to "ask AI what technology to use before starting."

4. **Project Planning Discipline**: Always create a `plan.md` before coding, keep files short and focused, plan for future features upfront.

5. **Vibe Coding Psychology**: The "last 20%" problem — initial development is exciting but finishing (bug fixes, edge cases, deployment) requires discipline. Platform choice affects feedback loop speed.

---

## Proposed Skills & Agents

### Priority 1: Design Brief Agent (High Impact)

**Type**: New procedure + agent
**Rationale**: This is the most novel and impactful idea from the article. Cyrus currently has no design-oriented workflow. When users create Linear issues for new pages, landing pages, or UI features, Cyrus jumps straight to coding. A design brief phase would produce higher-quality output by establishing brand voice, UX flow, visual direction, and component specs before implementation.

**What it does**:
- New `design-brief` procedure with subroutines: `brand-discovery` -> `ux-analysis` -> `visual-direction` -> `ui-specification` -> `brief-compilation`
- Produces a `BRIEF.md` file in the worktree with: sections, typography, colors, spacing, motion, component specs, accessibility requirements
- The brief then feeds into the existing `coding-activity` subroutine as context

**Implementation approach**:
1. Create new subroutine prompt files:
   - `subroutines/brand-discovery.md` — Analyzes project context, audience, positioning, voice
   - `subroutines/ux-analysis.md` — Maps sections, user journeys, conversion mechanics, accessibility
   - `subroutines/visual-direction.md` — Proposes typography, color, spacing, motion, dark mode
   - `subroutines/ui-specification.md` — Component structure, layout systems, design tokens
   - `subroutines/brief-compilation.md` — Compiles all outputs into BRIEF.md
2. Register new `design-then-build` procedure in `registry.ts`:
   ```
   brand-discovery -> ux-analysis -> visual-direction -> ui-specification ->
   brief-compilation -> coding-activity -> verifications -> changelog-update ->
   git-commit -> gh-pr -> concise-summary
   ```
3. Add `design` classification to `ProcedureAnalyzer` for issues that request UI/design work
4. Optionally add a `design` label for explicit routing

**Estimated complexity**: Medium-High (new procedure + 5 subroutine prompts + classifier update)

---

### Priority 2: Tech Stack Advisor Skill (Medium Impact)

**Type**: New skill (`.claude/skills/tech-advisor/SKILL.md`)
**Rationale**: The article's tech selection framework is practical — many users create Cyrus issues without specifying a tech stack. Having Cyrus proactively recommend and justify technology choices before implementation prevents costly refactoring.

**What it does**:
- Invocable as `/tech-advisor` or auto-triggered during the `preparation` subroutine
- Analyzes project requirements (static vs dynamic, user auth, data persistence, SEO needs, content-heavy vs interactive)
- Recommends framework/stack with rationale (HTML+CSS, React, Next.js, Astro, etc.)
- Outputs recommendation to issue comments before coding begins

**Implementation approach**:
1. Create `.claude/skills/tech-advisor/SKILL.md` with:
   - Decision tree logic from the article
   - Questions to evaluate: Does it need user accounts? Persistent data? Multiple pages? SEO?
   - Recommendations mapped to project types
2. Optionally integrate into the `preparation` subroutine to auto-run for new projects

**Estimated complexity**: Low (single skill file)

---

### Priority 3: Project Scaffolding Skill (Medium Impact)

**Type**: New skill (`.claude/skills/scaffold/SKILL.md`)
**Rationale**: The article emphasizes creating a `plan.md` before coding and keeping files short/focused. Cyrus could formalize this as a scaffolding step that creates project structure plans before implementation.

**What it does**:
- Creates a `plan.md` (or updates it) with project structure, file organization, and architecture decisions
- Ensures files stay focused and small (the article's key lesson for AI-friendly codebases)
- Documents future feature considerations upfront

**Implementation approach**:
1. Create `.claude/skills/scaffold/SKILL.md` with:
   - Template for `plan.md` generation
   - File size/focus guidelines
   - Architecture documentation requirements
2. Can be invoked as `/scaffold` or auto-triggered for `Feature` issues on new repos

**Estimated complexity**: Low (single skill file)

---

### Priority 4: Visual Reference Skill (Medium Impact)

**Type**: New skill (`.claude/skills/visual-ref/SKILL.md`)
**Rationale**: The article repeatedly emphasizes using screenshots and design references as communication tools. Cyrus could formalize a workflow where users attach visual references to Linear issues and the agent uses them systematically.

**What it does**:
- Detects image attachments on Linear issues
- Downloads and analyzes reference images/screenshots
- Extracts design intent: layout patterns, spacing, typography, color usage
- Incorporates visual analysis into the coding prompt

**Implementation approach**:
1. Create `.claude/skills/visual-ref/SKILL.md` with:
   - Instructions for analyzing attached images
   - Pattern extraction methodology
   - Integration with design brief or coding-activity prompts
2. Enhance prompt assembly to detect and process image attachments
3. Add visual reference context to the system prompt when images are present

**Estimated complexity**: Medium (skill file + prompt assembly enhancement)

---

### Priority 5: Iterative Refinement Procedure Enhancement (Low-Medium Impact)

**Type**: Enhancement to existing procedures
**Rationale**: The article's core message is "keep going until you're happy" — iterative refinement through conversation. Cyrus already supports mid-implementation prompting, but could formalize a "polish" phase where the agent self-reviews output quality.

**What it does**:
- After `coding-activity`, adds a self-review subroutine that evaluates output against the original request
- Checks: Does the implementation match the intent? Are there obvious UX issues? Is the code clean?
- Optionally loops back to `coding-activity` for refinements

**Implementation approach**:
1. Create `subroutines/self-review.md` prompt:
   - Compare implementation against issue requirements
   - Check for common quality issues (accessibility, responsive design, edge cases)
   - Decide: proceed or refine
2. Insert into `full-development` procedure after `coding-activity`, before `verifications`
3. Use the existing validation loop pattern (`usesValidationLoop`) for retry logic

**Estimated complexity**: Medium (new subroutine + procedure modification)

---

## Implementation Priority & Sequencing

| # | Skill/Agent | Impact | Complexity | Dependencies |
|---|------------|--------|------------|--------------|
| 1 | **Design Brief Agent** | High | Medium-High | None |
| 2 | **Tech Stack Advisor** | Medium | Low | None |
| 3 | **Project Scaffolding** | Medium | Low | None |
| 4 | **Visual Reference** | Medium | Medium | Prompt assembly changes |
| 5 | **Iterative Refinement** | Low-Medium | Medium | Existing validation loop |

**Recommended order**: Start with #2 and #3 (low complexity, quick wins), then #1 (highest impact), then #4 and #5 as follow-ups.

---

## What NOT to Include

The following items from the article are **not** worth implementing as Cyrus skills:

1. **Claude Code installation guide** — Already handled by Cyrus setup docs; not relevant to agent skills.
2. **Vibe coding psychology/motivation** — Interesting reading but not actionable as a skill.
3. **Platform selection advice** (web vs native) — Too generic; Cyrus operates on existing repos.
4. **Emotional feedback/praise techniques** — Cyrus's prompting is already optimized; adding "be nice to the AI" as a skill adds no value.

---

## Key Learnings to Incorporate into Cyrus CLAUDE.md

Even without building new skills, these article insights should be documented as best practices:

1. **One feature at a time** — Reinforce in `coding-activity.md` that changes should be incremental
2. **Provide context** — Ensure system prompts always include project purpose and user intent
3. **Visual references** — Document in CLAUDE.md that users can attach images to Linear issues
4. **Plan before code** — Already covered by `plan-mode` procedure but worth reinforcing
5. **Keep files small** — Add guidance to `coding-activity.md` about file size/focus

---

## Next Steps

1. Review this plan and approve priorities
2. Create sub-issues for each approved skill/agent
3. Implement in recommended order (quick wins first, then high-impact)
4. Test each skill via F1 test drives before merging
