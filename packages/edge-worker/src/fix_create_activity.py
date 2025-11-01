#!/usr/bin/env python3
import re

with open('EdgeWorker.ts', 'r') as f:
    content = f.read()

# Fix #1: Line ~486 - parentSessionId
content = re.sub(
    r'const result = await linearClient\.createAgentActivity\(\{\s+agentSessionId: parentSessionId,\s+content: \{\s+type: "thought",\s+body: resultThought,\s+\},\s+\}\);',
    'await linearClient.createAgentActivity(parentSessionId, {\n\t\t\t\ttype: AgentActivityContentType.Thought,\n\t\t\t\tbody: resultThought,\n\t\t\t});',
    content,
    flags=re.DOTALL
)

# Remove the if/else block after first fix
content = re.sub(
    r'await linearClient\.createAgentActivity\(parentSessionId, \{[^}]+\}\);\s+if \(result\.success\) \{([^}]+\})\s+\} else \{[^}]+result[^}]+\}',
    lambda m: f'await linearClient.createAgentActivity(parentSessionId, {{\n\t\t\t\ttype: AgentActivityContentType.Thought,\n\t\t\t\tbody: resultThought,\n\t\t\t}});\n\n{m.group(1)}',
    content,
    flags=re.DOTALL
)

# Fix #2: Line ~890 - session.linearAgentActivitySessionId (repository removal)
content = re.sub(
    r'await linearClient\.createAgentActivity\(\{\s+agentSessionId: session\.linearAgentActivitySessionId,\s+content: \{\s+type: "response",\s+body: `\*\*Repository Removed from Configuration\*\*',
    'await linearClient.createAgentActivity(session.linearAgentActivitySessionId, {\n\t\t\t\t\t\t\ttype: AgentActivityContentType.Response,\n\t\t\t\t\t\t\tbody: `**Repository Removed from Configuration**',
    content
)

# Remove extra content/closing braces for fix #2
content = re.sub(
    r'(await linearClient\.createAgentActivity\(session\.linearAgentActivitySessionId, \{\s+type: AgentActivityContentType\.Response,\s+body: `[^`]+`),\s+\},\s+\}\);',
    r'\1\n\t\t\t\t\t\t});',
    content
)

# Fix #3: Line ~3385 - childSessionId
content = re.sub(
    r'const result = await linearClient\.createAgentActivity\(\{\s+agentSessionId: childSessionId,\s+content: \{\s+type: "thought",\s+body: feedbackThought,\s+\},\s+\}\);',
    'await linearClient.createAgentActivity(childSessionId, {\n\t\t\t\t\t\ttype: AgentActivityContentType.Thought,\n\t\t\t\t\t\tbody: feedbackThought,\n\t\t\t\t\t});',
    content
)

# Remove if/else for fix #3
content = re.sub(
    r'(await linearClient\.createAgentActivity\(childSessionId, \{[^}]+feedbackThought[^}]+\}\);)\s+if \(result\.success\) \{([^}]+\})\s+\} else \{[^}]+Failed to post feedback receipt thought[^}]+\}',
    lambda m: f'{m.group(1)}\n\n{m.group(2)}',
    content,
    flags=re.DOTALL
)

# Fixes #4-7: activityInput pattern
# These all follow the pattern:
# const activityInput = { agentSessionId: X, content: { type: "Y", body: Z } };
# const result = await linearClient.createAgentActivity(activityInput);
# if (result.success) { ... } else { ... }

def fix_activity_input(match):
    indent = match.group(1)
    session_id = match.group(2)
    activity_type = match.group(3)
    body = match.group(4)
    success_log = match.group(5)
    
    # Convert type to enum
    enum_type = activity_type.capitalize()
    
    return f'''{indent}await linearClient.createAgentActivity({session_id}, {{
{indent}\ttype: AgentActivityContentType.{enum_type},
{indent}\tbody: {body}
{indent}}});
{indent}{success_log}'''

pattern = r'(\t+)const activityInput = \{\s+agentSessionId: ([^,]+),\s+content: \{\s+type: "([^"]+)",\s+body: ([^}]+)\},\s+\};\s+const result = await linearClient\.createAgentActivity\(activityInput\);\s+if \(result\.success\) \{\s+(console\.log\([^)]+\);)\s+\} else \{[^}]+\}'

content = re.sub(pattern, fix_activity_input, content, flags=re.DOTALL)

with open('EdgeWorker.ts', 'w') as f:
    f.write(content)

print("Fixed all createAgentActivity calls")
