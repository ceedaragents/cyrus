#!/usr/bin/env python3
import re

file_path = '/Users/agentops/code/cyrus-workspaces/CYPACK-313/packages/edge-worker/src/EdgeWorker.ts'

with open(file_path, 'r') as f:
    content = f.read()

print("Fixing method signatures...")

# Fix 1: fetchComments - change from filter object to just issueId
# OLD: await linearClient.fetchComments({ filter: { issue: { id: { eq: issue.id } } } })
# NEW: await linearClient.fetchComments(issue.id)
content = re.sub(
    r'await linearClient\.fetchComments\(\{\s*filter:\s*\{\s*issue:\s*\{\s*id:\s*\{\s*eq:\s*([^}]+)\s*\}\s*\}\s*\}\s*\}\)',
    r'await linearClient.fetchComments(\1)',
    content
)

# Fix 2: fetchComment - change from object to just commentId
# OLD: await linearClient.fetchComment({ id: newComment.id })
# NEW: await linearClient.fetchComment(newComment.id)
content = re.sub(
    r'await linearClient\.fetchComment\(\{\s*id:\s*([^}]+)\s*\}\)',
    r'await linearClient.fetchComment(\1)',
    content
)

# Fix 3: fetchWorkflowStates - change from filter object to just teamId
# OLD: await linearClient.fetchWorkflowStates({ filter: { team: { id: { eq: team.id } } } })
# NEW: await linearClient.fetchWorkflowStates(team.id)
content = re.sub(
    r'await linearClient\.fetchWorkflowStates\(\{\s*filter:\s*\{\s*team:\s*\{\s*id:\s*\{\s*eq:\s*([^}]+)\s*\}\s*\}\s*\}\s*\}\)',
    r'await linearClient.fetchWorkflowStates(\1)',
    content
)

# Fix 4: Change .parent to .parentId
content = re.sub(r'\.parent([^I])', r'.parentId\1', content)

with open(file_path, 'w') as f:
    f.write(content)

print("Fixed method signatures")
