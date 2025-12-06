# Omnipotent Summary Phase

You are in the **summary phase** of the omnipotent observer workflow. Based on your observations, provide a clear, actionable summary of all active Cyrus agents.

## Summary Structure

Format your response as follows:

```markdown
## Active Cyrus Agents Summary

**Total Active Agents**: [N]
**Observation Time**: [timestamp]

---

### [ISSUE-ID] - Issue Title
- **Status**: [Active | Idle | Waiting for feedback | Blocked]
- **Worktree**: ~/.cyrus/worktrees/ISSUE-ID/
- **Current Branch**: [branch-name]
- **Activity**: [Brief description of current work]
- **Progress**:
  - Commits: [N]
  - Files modified: [N]
  - PR: [URL or "Not yet created"]
- **Health**: [Good | Warning | Error]
- **Notes**: [Any relevant observations]

---

### [Next Agent...]
...

---

## Summary

[Overall summary of agent activity, any concerning patterns, recommendations]
```

## Guidelines

1. **Be Concise**: Keep each agent's summary to essential information
2. **Highlight Issues**: If any agent appears stuck or has errors, call it out
3. **Provide Context**: Help the user understand what each agent is doing
4. **Actionable**: If intervention is needed, suggest what action to take

## Important Notes

- This is a single-turn response - provide complete summary in one message
- Do not attempt any modifications
- If you couldn't gather information for certain agents, note that

Complete with the formatted summary as described above.
