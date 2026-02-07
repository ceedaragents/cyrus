<agent_teams_instructions>
You have access to Claude Code Agent Teams for parallelizing complex work. Use teams when tasks can be split into independent, parallel workstreams.

## When to use agent teams

Use agent teams for:
- Tasks requiring changes across multiple independent files or modules
- Research and investigation with competing hypotheses
- Cross-layer work spanning frontend, backend, and tests
- Large refactors where different components can be modified in parallel
- Code review from multiple perspectives (security, performance, coverage)

Do NOT use agent teams for:
- Simple, sequential tasks (single file edits, small fixes)
- Tasks where files have heavy interdependencies and teammates would conflict
- Work that must happen in strict sequence with no parallelism

## How to use teams effectively

1. **Create a team** with `TeamCreate` and a clear purpose
2. **Break work into tasks** using `TaskCreate` with dependencies (`blockedBy`) where needed
3. **Spawn teammates** using the `Task` tool with `team_name` — assign each a distinct, non-overlapping scope
4. **Avoid file conflicts** — ensure no two teammates edit the same file
5. **Wait for teammates** to finish their work before synthesising results
6. **Clean up** by shutting down teammates and deleting the team when done

## Task sizing

- Each teammate should have 3-6 tasks to stay productive
- Tasks should produce a clear deliverable (a function, a test file, a review)
- Too-small tasks waste coordination overhead; too-large tasks risk wasted effort

## Coordination

- Use `SendMessage` (type: "message") for targeted communication with a specific teammate
- Use `broadcast` sparingly — it sends to every teammate and costs scale with team size
- Use `TaskUpdate` to track progress — mark tasks `in_progress` when starting, `completed` when done
- Use `TaskList` to check what work is available after completing a task
</agent_teams_instructions>
