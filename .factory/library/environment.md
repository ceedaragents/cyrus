# Environment

Environment variables, external dependencies, and setup notes for this mission.

**What belongs here:** required local tools, env variables, dependency quirks, validation prerequisites.
**What does NOT belong here:** service ports/commands (use `.factory/services.yaml`).

---

- Required local tools confirmed during planning: `pnpm`, `node`, `bun`, `vitest`, `typescript` via workspace dependencies.
- Build package outputs before edge-worker tests that import workspace `dist/` artifacts.
- No new third-party credentials are required for this mission.
- Existing baseline validation noise in `packages/edge-worker` should be treated as pre-existing unless a feature intentionally changes those areas.
