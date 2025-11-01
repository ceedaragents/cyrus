#!/usr/bin/env python3
"""
Fix all createAgentActivity calls in EdgeWorker.ts from:
  const result = await linearClient.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "thought", body: text }
  });
  if (result.success) { ... } else { ... }

To:
  await linearClient.createAgentActivity(sessionId, {
    type: AgentActivityContentType.Thought,
    body: text
  });
  // success log only
"""

import re

with open('EdgeWorker.ts', 'r') as f:
    lines = f.readlines()

def extract_session_id(line):
    """Extract the sessionId from agentSessionId: X line"""
    match = re.search(r'agentSessionId:\s*([^,\s]+)', line)
    return match.group(1) if match else None

def extract_type(line):
    """Extract type from type: "thought" line"""
    match = re.search(r'type:\s*"([^"]+)"', line)
    if match:
        t = match.group(1)
        return t.capitalize()  # thought -> Thought
    return None

def extract_body_start(line):
    """Extract body content - may be multiline"""
    match = re.search(r'body:\s*(.+)', line)
    return match.group(1).strip() if match else None

i = 0
while i < len(lines):
    line = lines[i]
    
    # Pattern 1: Inline object parameter (lines 486, 3385)
    if re.search(r'const result = await linearClient\.createAgentActivity\(\{', line):
        start_line = i
        # Read the full call
        session_id = None
        type_val = None
        body_lines = []
        body_started = False
        indent = len(line) - len(line.lstrip())
        
        i += 1
        while i < len(lines):
            if 'agentSessionId:' in lines[i]:
                session_id = extract_session_id(lines[i])
            elif 'type:' in lines[i]:
                type_val = extract_type(lines[i])
            elif 'body:' in lines[i]:
                body_start = extract_body_start(lines[i])
                if body_start.endswith(','):
                    body_start = body_start[:-1]
                body_lines.append(body_start)
                body_started = True
            elif body_started and not lines[i].strip().startswith('}'):
                # Continuation of body
                body_line = lines[i].strip()
                if body_line.endswith(','):
                    body_line = body_line[:-1]
                if body_line:
                    body_lines.append(body_line)
            elif '});' in lines[i]:
                # End of createAgentActivity call
                i += 1
                break
            i += 1
        
        # Now find and remove the if/else block
        if_start = None
        if i < len(lines) and 'if (result.success)' in lines[i]:
            if_start = i
            # Find the matching closing brace
            brace_count = 0
            else_found = False
            success_log = None
            
            i += 1
            while i < len(lines):
                if '{' in lines[i]:
                    brace_count += 1
                if '}' in lines[i]:
                    brace_count -= 1
                    if brace_count == 0 and not else_found:
                        # End of success block - extract the console.log
                        for j in range(if_start + 1, i):
                            if 'console.log' in lines[j]:
                                success_log = lines[j]
                                break
                        # Check if there's an else
                        i += 1
                        if i < len(lines) and 'else' in lines[i]:
                            else_found = True
                            brace_count = 0
                        else:
                            break
                    elif brace_count == 0 and else_found:
                        # End of else block
                        i += 1
                        break
                i += 1
        
        # Reconstruct the call
        body_str = ' '.join(body_lines) if body_lines else 'body'
        indent_str = '\t' * (indent // 4)
        
        new_lines = [
            f'{indent_str}await linearClient.createAgentActivity({session_id}, {{\n',
            f'{indent_str}\ttype: AgentActivityContentType.{type_val},\n',
            f'{indent_str}\tbody: {body_str},\n',
            f'{indent_str}}});\n',
            '\n',
        ]
        
        if success_log:
            new_lines.append(success_log)
        
        # Replace the lines
        del lines[start_line:i]
        for idx, new_line in enumerate(new_lines):
            lines.insert(start_line + idx, new_line)
        
        i = start_line + len(new_lines)
        continue
    
    # Pattern 2: activityInput variable (lines 4236, 4279, 4524, 4710)
    if re.search(r'const activityInput = \{', line):
        start_line = i
        session_id = None
        type_val = None
        body_lines = []
        indent = len(line) - len(line.lstrip())
        
        # Read activityInput definition
        i += 1
        body_started = False
        while i < len(lines) and not re.search(r'^\s*\};?\s*$', lines[i]):
            if 'agentSessionId:' in lines[i]:
                session_id = extract_session_id(lines[i])
            elif 'type:' in lines[i]:
                type_val = extract_type(lines[i])
            elif 'body:' in lines[i]:
                body_start = extract_body_start(lines[i])
                if body_start.endswith(','):
                    body_start = body_start[:-1]
                body_lines.append(body_start)
                body_started = True
            elif body_started:
                body_line = lines[i].strip()
                if body_line and not body_line.startswith('}'):
                    if body_line.endswith(','):
                        body_line = body_line[:-1]
                    body_lines.append(body_line)
            i += 1
        
        # Skip the closing }; line
        if i < len(lines):
            i += 1
        
        # Skip blank line if present
        if i < len(lines) and lines[i].strip() == '':
            i += 1
        
        # Skip the const result = await line
        if i < len(lines) and 'const result = await linearClient.createAgentActivity(activityInput)' in lines[i]:
            i += 1
        
        # Find and extract success block
        success_log = None
        if i < len(lines) and 'if (result.success)' in lines[i]:
            if_line = i
            i += 1
            # Find console.log in success block
            brace_count = 0
            while i < len(lines):
                if '{' in lines[i]:
                    brace_count += 1
                if 'console.log' in lines[i]:
                    success_log = lines[i]
                if '}' in lines[i]:
                    brace_count -= 1
                    if brace_count == 0:
                        i += 1
                        # Check for else block
                        if i < len(lines) and 'else' in lines[i]:
                            # Skip else block
                            brace_count = 0
                            i += 1
                            while i < len(lines):
                                if '{' in lines[i]:
                                    brace_count += 1
                                if '}' in lines[i]:
                                    brace_count -= 1
                                    if brace_count == 0:
                                        i += 1
                                        break
                                i += 1
                        break
                i += 1
        
        # Reconstruct
        body_str = ' '.join(body_lines) if body_lines else 'body'
        indent_str = '\t' * (indent // 4)
        
        new_lines = [
            f'{indent_str}await linearClient.createAgentActivity({session_id}, {{\n',
            f'{indent_str}\ttype: AgentActivityContentType.{type_val},\n',
            f'{indent_str}\tbody: {body_str},\n',
            f'{indent_str}}});\n',
        ]
        
        if success_log:
            new_lines.append(success_log)
        
        # Replace
        del lines[start_line:i]
        for idx, new_line in enumerate(new_lines):
            lines.insert(start_line + idx, new_line)
        
        i = start_line + len(new_lines)
        continue
    
    # Pattern 3: await without const result (line 890 - already partially fixed)
    if re.search(r'await linearClient\.createAgentActivity\(\{', line) and 'const result' not in line:
        start_line = i
        session_id = None
        type_val = None
        body_lines = []
        indent = len(line) - len(line.lstrip())
        
        # Already in two-parameter form? Skip it
        if re.search(r'await linearClient\.createAgentActivity\([^{]+,\s*\{', line):
            i += 1
            continue
        
        # Read the object parameter
        i += 1
        body_started = False
        while i < len(lines):
            if 'agentSessionId:' in lines[i]:
                session_id = extract_session_id(lines[i])
            elif 'type:' in lines[i]:
                type_val = extract_type(lines[i])
            elif 'body:' in lines[i]:
                body_start = extract_body_start(lines[i])
                if body_start.endswith(','):
                    body_start = body_start[:-1]
                body_lines.append(body_start)
                body_started = True
            elif body_started and not lines[i].strip().startswith('}'):
                body_line = lines[i].strip()
                if body_line.endswith(','):
                    body_line = body_line[:-1]
                if body_line:
                    body_lines.append(body_line)
            elif '});' in lines[i]:
                i += 1
                break
            i += 1
        
        # Reconstruct
        body_str = ' '.join(body_lines) if body_lines else 'body'
        indent_str = '\t' * (indent // 4)
        
        new_lines = [
            f'{indent_str}await linearClient.createAgentActivity({session_id}, {{\n',
            f'{indent_str}\ttype: AgentActivityContentType.{type_val},\n',
            f'{indent_str}\tbody: {body_str},\n',
            f'{indent_str}}});\n',
        ]
        
        # Replace
        del lines[start_line:i]
        for idx, new_line in enumerate(new_lines):
            lines.insert(start_line + idx, new_line)
        
        i = start_line + len(new_lines)
        continue
    
    i += 1

# Write back
with open('EdgeWorker.ts', 'w') as f:
    f.writelines(lines)

print("Fixed all createAgentActivity calls")
