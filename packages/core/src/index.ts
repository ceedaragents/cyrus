// export { Session } from './Session.js'
// export type { SessionOptions, , NarrativeItem } from './Session.js'
// export { ClaudeSessionManager as SessionManager } from './ClaudeSessionManager.js'

export type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	IssueMinimal,
	Workspace,
} from "./CyrusAgentSession.js";
export type {
	SerializableEdgeWorkerState,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
} from "./PersistenceManager.js";
export { PersistenceManager } from "./PersistenceManager.js";

// Re-export Linear SDK webhook types for backward compatibility
// These are now the official Linear SDK types
export type {
	LinearWebhookPayload,
	AgentSessionEventWebhookPayload,
	AppUserNotificationWebhookPayloadWithNotification,
	EntityWebhookPayloadWithIssueData,
	EntityWebhookPayloadWithCommentData,
} from "@linear/sdk/webhooks";

// Keep minimal type exports for components that still need them
export type {
	LinearWebhookTeam,
	LinearWebhookIssue,
	LinearWebhookComment,
	LinearWebhookActor,
	LinearWebhookAgentSession,
	LinearWebhookAgentActivity,
	LinearWebhookAgentActivityContent,
	LinearWebhookCreator,
	LinearWebhookIssueState,
} from "./webhook-types.js";
