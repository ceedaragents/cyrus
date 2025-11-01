#!/bin/bash

# Fix #1: Line 881-887 - Repository removal message
sed -i.bak10 '881s/await linearClient\.createAgentActivity({/await linearClient.createAgentActivity(session.linearAgentActivitySessionId, {/' EdgeWorker.ts
sed -i.bak11 '882d' EdgeWorker.ts  # Delete agentSessionId line
sed -i.bak12 '882d' EdgeWorker.ts  # Delete content: { line
sed -i.bak13 '882s/type: "response",/type: AgentActivityContentType.Response,/' EdgeWorker.ts
# Body line stays as is
sed -i.bak14 '883s/},//' EdgeWorker.ts  # Remove closing }, for content

# Fix #2: Line 4476-4494 - activityInput for system prompt selection
sed -i.bak15 '4476,4482d' EdgeWorker.ts  # Delete activityInput definition
sed -i.bak16 '4476s/const result = await linearClient\.createAgentActivity(activityInput);/await linearClient.createAgentActivity(linearAgentActivitySessionId, {\n\t\t\ttype: AgentActivityContentType.Thought,\n\t\t\tbody: `Entering '\''${selectedPromptType}'\'' mode because of the '\''${triggerLabel}'\'' label. I'\''ll follow the ${selectedPromptType} process...`,\n\t\t});/' EdgeWorker.ts
sed -i.bak17 '4477,4486d' EdgeWorker.ts  # Delete if/else block
sed -i.bak18 '4477i\
\t\t\tconsole.log(\
\t\t\t\t`[EdgeWorker] Posted system prompt selection thought for session ${linearAgentActivitySessionId} (${selectedPromptType} mode)`,\
\t\t\t);' EdgeWorker.ts

# Fix #3: Line 4662-4680 - activityInput for instant prompted acknowledgment
sed -i.bak19 '4662,4668d' EdgeWorker.ts  # Delete activityInput definition
sed -i.bak20 '4662s/const result = await linearClient\.createAgentActivity(activityInput);/await linearClient.createAgentActivity(linearAgentActivitySessionId, {\n\t\t\ttype: AgentActivityContentType.Thought,\n\t\t\tbody: message,\n\t\t});/' EdgeWorker.ts
sed -i.bak21 '4663,4672d' EdgeWorker.ts  # Delete if/else block
sed -i.bak22 '4663i\
\t\t\tconsole.log(\
\t\t\t\t`[EdgeWorker] Posted instant prompted acknowledgment thought for session ${linearAgentActivitySessionId} (streaming: ${isStreaming})`,\
\t\t\t);' EdgeWorker.ts

echo "Manual fixes applied"
