## Linear Webhook Constraints

### agentSessionCreated

**IMPORTANT NOTE:** A delegation always triggers the first agentSession on a Linear issue. An @ mention can trigger either the first or an additional agentSession on a Linear issue.

When the first agentSession is created for a Linear issue, repositories are resolved via routing logic and stored on the CyrusAgentSession's `repositoryIds` field. A session may be associated with 0, 1, or N repositories.

If repositories cannot be matched based on the metadata of the Linear issue and the configured routing, then an agentSession select signal should be sent to Linear with the configured repositories as options. In this case, a Claude runner should NOT be initialized until the subsequent agentSessionPrompted webhook is received.

For additional agentSessions on the same issue, repositories are looked up from the existing session's `repositoryIds`.

An agentSessionCreated webhook has two triggers from Linear:

#### via @ mention:

- Skips label-based system prompt by default if (!isMentionTriggered || isLabelBasedPromptRequested))

- No system prompt unless user explicitly uses `/label-based-prompt` command

- More flexible/conversational mode

#### via delegation:

- Uses label-based system prompt routing.

- Checks issue labels for debugger, orchestrator, or other custom prompts.

- Falls back to procedure-based system prompt.

### agentSessionPrompted

An agentSessionPrompted webhook has three different handling branches:

#### if (agentActivity.signal === "stop"):

When this signal is received, all claudeRunners associated with this agentSession MUST be terminated. In this case, an agentSession MUST already exist.

#### if (this.repositoryRouter.hasPendingSelection(agentSessionId)):

When the pendingSelection flag is set for an agentSessionCreated webhook, the subsequent agentSessionPrompted webhook will either have the result of the selection or an unrelated response from the user ignoring the selection.
Currently, we only use the select signal for repository selection when the agentSessionCreated webhook can not route the metadata of the Linear issue to a configured repository. In this case, a select signal is posted to Linear,
which provides the user with options of the configured repositories. The user can then select a repository, which will send a agentSessionPrompted webhook where the body matches one of the options sent via the select signal, or an
unrelated prompt which we should handle by just using the fallback repo (first repo configured). In both cases, a Claude runner should be initialized.

#### else:

For this case an agentSession MUST exist and repositories MUST already be associated via the session's `repositoryIds` field. No new routing logic is performed — the session carries its own repository associations.
