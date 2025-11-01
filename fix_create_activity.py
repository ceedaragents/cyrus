#!/usr/bin/env python3
import re

file_path = '/Users/agentops/code/cyrus-workspaces/CYPACK-313/packages/edge-worker/src/EdgeWorker.ts'

with open(file_path, 'r') as f:
    content = f.read()

# Count occurrences
print(f"Before: {content.count('createAgentActivity')} createAgentActivity calls")
print(f"Before: {content.count('result.success')} result.success checks")

# Fix inline calls with if/else
fixes_applied = 0

def fix_inline_with_result(match):
    global fixes_applied
    fixes_applied += 1
    indent = match.group(1)
    session_id = match.group(2)
    type_str = match.group(3)
    body = match.group(4).strip()
    if body.endswith(','):
        body = body[:-1]
    log_line = match.group(5)
    
    type_enum = type_str.capitalize()
    
    return f'''{indent}await linearClient.createAgentActivity({session_id}, {{
{indent}\ttype: AgentActivityContentType.{type_enum},
{indent}\tbody: {body},
{indent}}});

{indent}{log_line}'''

# Pattern 1: const result = ... }); if (result.success) { ... } else { ... }
pattern1 = r'(\t+)const result = await linearClient\.createAgentActivity\(\{\s+agentSessionId: ([^,]+),\s+content: \{\s+type: "([^"]+)",\s+body: ([^}]+)\},\s+\}\);\s+if \(result\.success\) \{\s+(console\.log\([^)]+\);\s+)\} else \{[^}]+result[^}]+\}'

content = re.sub(pattern1, fix_inline_with_result, content, flags=re.DOTALL)

# Pattern 2: await call without const result
def fix_await_no_result(match):
    global fixes_applied
    fixes_applied += 1
    indent = match.group(1)
    session_id = match.group(2)
    type_str = match.group(3)
    body_content = match.group(4)
    
    type_enum = type_str.capitalize()
    
    return f'''{indent}await linearClient.createAgentActivity({session_id}, {{
{indent}\ttype: AgentActivityContentType.{type_enum},
{indent}\tbody: {body_content}
{indent}}});'''

pattern2 = r'(\t+)await linearClient\.createAgentActivity\(\{\s+agentSessionId: ([^,]+),\s+content: \{\s+type: "([^"]+)",\s+body: ([^}]+)\},\s+\}\);'

content = re.sub(pattern2, fix_await_no_result, content, flags=re.DOTALL)

# Pattern 3: activityInput variable
def fix_activity_input(match):
    global fixes_applied
    fixes_applied += 1
    indent = match.group(1)
    session_id = match.group(2)
    type_str = match.group(3)
    body = match.group(4).strip()
    if body.endswith(','):
        body = body[:-1]
    log_line = match.group(5)
    
    type_enum = type_str.capitalize()
    
    return f'''{indent}await linearClient.createAgentActivity({session_id}, {{
{indent}\ttype: AgentActivityContentType.{type_enum},
{indent}\tbody: {body},
{indent}}});
{indent}{log_line}'''

pattern3 = r'(\t+)const activityInput = \{\s+agentSessionId: ([^,]+),\s+content: \{\s+type: "([^"]+)",\s+body: ([^}]+)\},\s+\};\s+const result = await linearClient\.createAgentActivity\(activityInput\);\s+if \(result\.success\) \{\s+(console\.log\([^)]+\);\s+)\} else \{[^}]+result[^}]+\}'

content = re.sub(pattern3, fix_activity_input, content, flags=re.DOTALL)

with open(file_path, 'w') as f:
    f.write(content)

print(f"Applied {fixes_applied} fixes")
print(f"After: {content.count('createAgentActivity')} createAgentActivity calls")
print(f"After: {content.count('result.success')} result.success checks")
