// export { Session } from './Session.js'
// export type { SessionOptions, , NarrativeItem } from './Session.js'
// export { ClaudeSessionManager as SessionManager } from './ClaudeSessionManager.js'

// Re-export Linear SDK webhook types for backward compatibility
// These are now the official Linear SDK types
export type {
	AgentSessionEventWebhookPayload,
	AppUserNotificationWebhookPayloadWithNotification,
	EntityWebhookPayloadWithCommentData,
	EntityWebhookPayloadWithIssueData,
	LinearWebhookPayload,
} from "@linear/sdk/webhooks";
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

// Keep minimal type exports for components that still need them
export type {
	LinearWebhookActor,
	LinearWebhookAgentActivity,
	LinearWebhookAgentActivityContent,
	LinearWebhookAgentSession,
	LinearWebhookComment,
	LinearWebhookCreator,
	LinearWebhookIssue,
	LinearWebhookIssueState,
	LinearWebhookTeam,
} from "./webhook-types.js";
