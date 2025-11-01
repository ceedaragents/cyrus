#!/usr/bin/env python3
import re

file_path = '/Users/agentops/code/cyrus-workspaces/CYPACK-313/packages/edge-worker/src/EdgeWorker.ts'

with open(file_path, 'r') as f:
    content = f.read()

print("Before fixes:")
print(f"  createAgentActivity calls: {content.count('createAgentActivity')}")
print(f"  result.success checks: {content.count('result.success')}")

# Fix #1: Line ~881 - Multi-line body with Repository Removed message  
old1 = '''await linearClient.createAgentActivity({
									agentSessionId: session.linearAgentActivitySessionId,
									content: {
										type: "response",
										body: `**Repository Removed from Configuration**\\n\\nThis repository (\\`${repo.name}\\`) has been removed from the Cyrus configuration. All active sessions for this repository have been stopped.\\n\\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
									},
								});'''

new1 = '''await linearClient.createAgentActivity(session.linearAgentActivitySessionId, {
									type: AgentActivityContentType.Response,
									body: `**Repository Removed from Configuration**\\n\\nThis repository (\\`${repo.name}\\`) has been removed from the Cyrus configuration. All active sessions for this repository have been stopped.\\n\\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
								});'''

if old1 in content:
    content = content.replace(old1, new1)
    print("✓ Fixed #1: Repository removal message")
else:
    print("✗ Could not find pattern #1")

# Fix #2: Line ~4476-4494 - System prompt selection with activityInput
old2 = '''const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
				},
			};

			const result = await linearClient.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted system prompt selection thought for session ${linearAgentActivitySessionId} (${selectedPromptType} mode)`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post system prompt selection thought:`,
					result,
				);
			}'''

new2 = '''await linearClient.createAgentActivity(linearAgentActivitySessionId, {
				type: AgentActivityContentType.Thought,
				body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
			});
			console.log(
				`[EdgeWorker] Posted system prompt selection thought for session ${linearAgentActivitySessionId} (${selectedPromptType} mode)`,
			);'''

if old2 in content:
    content = content.replace(old2, new2)
    print("✓ Fixed #2: System prompt selection")
else:
    print("✗ Could not find pattern #2")

# Fix #3: Line ~4662-4680 - Instant prompted acknowledgment with activityInput
old3 = '''const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: message,
				},
			};

			const result = await linearClient.createAgentActivity(activityInput);
			if (result.success) {
				console.log(
					`[EdgeWorker] Posted instant prompted acknowledgment thought for session ${linearAgentActivitySessionId} (streaming: ${isStreaming})`,
				);
			} else {
				console.error(
					`[EdgeWorker] Failed to post instant prompted acknowledgment:`,
					result,
				);
			}'''

new3 = '''await linearClient.createAgentActivity(linearAgentActivitySessionId, {
				type: AgentActivityContentType.Thought,
				body: message,
			});
			console.log(
				`[EdgeWorker] Posted instant prompted acknowledgment thought for session ${linearAgentActivitySessionId} (streaming: ${isStreaming})`,
			);'''

if old3 in content:
    content = content.replace(old3, new3)
    print("✓ Fixed #3: Instant prompted acknowledgment")
else:
    print("✗ Could not find pattern #3")

with open(file_path, 'w') as f:
    f.write(content)

print("\nAfter fixes:")
print(f"  createAgentActivity calls: {content.count('createAgentActivity')}")
print(f"  result.success checks: {content.count('result.success')} (should be 2 - from downloadAttachment)")
