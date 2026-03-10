# Architecture

Architectural decisions and discovered patterns for this mission.

**What belongs here:** steady-state state-model decisions, ownership boundaries, runtime lookup rules, migration constraints.
**What does NOT belong here:** exhaustive audit checklists (use the repository-association audit file).

---

- Mission target: repository participation for `CyrusAgentSession` must be explicit and support `0`, `1`, or `N` associated repositories.
- Steady-state runtime behavior must not derive repository identity from repo-keyed outer storage, singular issue-to-repository caches, or a singular workspace field.
- Backwards compatibility is limited to loading older persisted config/state and migrating it into the latest normalized model.
