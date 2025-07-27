/**
 * Linear webhook types based on actual webhook payloads
 * These are the exact structures Linear sends in webhooks
 */

/**
 * Linear team data from webhooks
 */
export interface LinearWebhookTeam {
  id: string    // e.g. "e66a639b-d4a1-433d-be4f-8c0438d42cd9"
  key: string   // e.g. "CEA"
  name: string  // e.g. "CeedarAgents"
}

/**
 * Linear issue data from webhooks
 */
export interface LinearWebhookIssue {
  id: string                     // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
  title: string                  // e.g. "test issue"
  teamId: string                 // e.g. "e66a639b-d4a1-433d-be4f-8c0438d42cd9"
  team: LinearWebhookTeam
  identifier: string             // e.g. "CEA-85"
  url: string                    // e.g. "https://linear.app/ceedaragents/issue/CEA-85/test-issue"
}

/**
 * Linear comment data from webhooks
 */
export interface LinearWebhookComment {
  id: string       // e.g. "3a5950aa-4f8c-4709-88be-e12b7f40bf78"
  body: string     // e.g. "this is a root comment"
  userId: string   // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  issueId: string  // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
}

/**
 * Linear actor (user) data from webhooks
 */
export interface LinearWebhookActor {
  id: string     // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  name: string   // e.g. "Connor Turland"
  email: string  // e.g. "connor@ceedar.ai"
  url: string    // e.g. "https://linear.app/ceedaragents/profiles/connor"
}

/**
 * Base notification structure common to all webhook notifications
 */
export interface LinearWebhookNotificationBase {
  id: string                          // e.g. "07de24f2-c624-48cd-90c2-a04dfd54ce48"
  createdAt: string                   // e.g. "2025-06-13T16:27:42.232Z"
  updatedAt: string                   // e.g. "2025-06-13T16:27:42.232Z"
  archivedAt: string | null           // null when not archived
  actorId: string                     // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  externalUserActorId: string | null  // null for internal users
  userId: string                      // e.g. "316d0aca-caf4-4c5a-88c3-628e107ce6c6"
  issueId: string                     // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
  issue: LinearWebhookIssue
  actor: LinearWebhookActor
}

/**
 * Issue assignment notification
 */
export interface LinearIssueAssignedNotification extends LinearWebhookNotificationBase {
  type: 'issueAssignedToYou'
}

/**
 * Issue comment mention notification
 */
export interface LinearIssueCommentMentionNotification extends LinearWebhookNotificationBase {
  type: 'issueCommentMention'
  commentId: string
  comment: LinearWebhookComment
}

/**
 * Issue new comment notification (can have parent comment for replies)
 */
export interface LinearIssueNewCommentNotification extends LinearWebhookNotificationBase {
  type: 'issueNewComment'
  commentId: string                      // e.g. "3a5950aa-4f8c-4709-88be-e12b7f40bf78"
  comment: LinearWebhookComment
  parentCommentId?: string               // Only present for reply comments
  parentComment?: LinearWebhookComment   // Only present for reply comments
}

/**
 * Issue unassignment notification
 */
export interface LinearIssueUnassignedNotification extends LinearWebhookNotificationBase {
  type: 'issueUnassignedFromYou'                        // e.g. "issueUnassignedFromYou"
  actorId: string                                       // e.g. "4df89eff-81af-4dd9-9201-cbac79892468"
  externalUserActorId: string | null                   // e.g. null
  userId: string                                        // e.g. "316d0aca-caf4-4c5a-88c3-628e107ce6c6"
  issueId: string                                       // e.g. "baffe010-6475-4e9a-9aa8-9544e31bf95f"
  issue: LinearWebhookIssue
  actor: LinearWebhookActor
}

/**
 * Union of all notification types
 */
export type LinearWebhookNotification = 
  | LinearIssueAssignedNotification
  | LinearIssueCommentMentionNotification
  | LinearIssueNewCommentNotification
  | LinearIssueUnassignedNotification

/**
 * Issue assignment webhook payload
 */
export interface LinearIssueAssignedWebhook {
  type: 'AppUserNotification'
  action: 'issueAssignedToYou'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  notification: LinearIssueAssignedNotification
  webhookTimestamp: number
  webhookId: string
}

/**
 * Issue comment mention webhook payload
 */
export interface LinearIssueCommentMentionWebhook {
  type: 'AppUserNotification'
  action: 'issueCommentMention'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  notification: LinearIssueCommentMentionNotification
  webhookTimestamp: number
  webhookId: string
}

/**
 * Issue new comment webhook payload
 */
export interface LinearIssueNewCommentWebhook {
  type: 'AppUserNotification'                          // Always this value for user notifications
  action: 'issueNewComment'                            // Webhook action type
  createdAt: string                                    // e.g. "2025-06-13T16:27:42.280Z"
  organizationId: string                               // e.g. "59b3d4a6-ed62-4e69-82db-b11c8dd76b84"
  oauthClientId: string                                // e.g. "c03d5b6e-5b75-4c2a-b656-d519cec2fc25"
  appUserId: string                                    // e.g. "316d0aca-caf4-4c5a-88c3-628e107ce6c6"
  notification: LinearIssueNewCommentNotification
  webhookTimestamp: number                             // e.g. 1749832062295
  webhookId: string                                    // e.g. "9fd215cd-b47d-4708-adca-3e7d287f0091"
}

/**
 * Issue unassignment webhook payload
 */
export interface LinearIssueUnassignedWebhook {
  type: 'AppUserNotification'                          // Always this value for user notifications
  action: 'issueUnassignedFromYou'                     // Webhook action type
  createdAt: string                                    // e.g. "2025-06-14T00:22:53.223Z"
  organizationId: string                               // e.g. "59b3d4a6-ed62-4e69-82db-b11c8dd76b84"
  oauthClientId: string                                // e.g. "c03d5b6e-5b75-4c2a-b656-d519cec2fc25"
  appUserId: string                                    // e.g. "316d0aca-caf4-4c5a-88c3-628e107ce6c6"
  notification: LinearIssueUnassignedNotification
  webhookTimestamp: number                             // e.g. 1749860573270
  webhookId: string                                    // e.g. "9fd215cd-b47d-4708-adca-3e7d287f0091"
}

/**
 * Creator data in agent session webhooks
 */
export interface LinearWebhookCreator {
  id: string
  name: string
  email: string
  avatarUrl: string
  url: string
}

/**
 * Agent Session data from webhooks
 */
export interface LinearWebhookAgentSession {
  id: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  creatorId: string
  appUserId: string
  commentId: string
  issueId: string
  status: 'pending' | 'active' | 'error' | 'awaiting-input' | 'complete'
  startedAt: string | null
  endedAt: string | null
  type: 'commentThread'
  summary: string | null
  sourceMetadata: any | null
  organizationId: string
  creator: LinearWebhookCreator
  comment: LinearWebhookComment
  issue: LinearWebhookIssue
}

/**
 * Agent Activity content types
 */
export interface LinearWebhookAgentActivityContent {
  type: 'prompt' | 'observation' | 'action' | 'error' | 'elicitation' | 'response'
  body: string
}

/**
 * Agent Activity data from webhooks
 */
export interface LinearWebhookAgentActivity {
  id: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  agentContextId: string | null
  agentSessionId: string
  sourceCommentId: string
  content: LinearWebhookAgentActivityContent
}

/**
 * Agent Session created webhook payload
 */
export interface LinearAgentSessionCreatedWebhook {
  type: 'AgentSessionEvent'
  action: 'created'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  agentSession: LinearWebhookAgentSession
  webhookTimestamp: string
  webhookId: string
}

/**
 * Agent Session prompted webhook payload
 */
export interface LinearAgentSessionPromptedWebhook {
  type: 'AgentSessionEvent'
  action: 'prompted'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  agentSession: LinearWebhookAgentSession
  agentActivity: LinearWebhookAgentActivity
  webhookTimestamp: string
  webhookId: string
}

/**
 * Union of all webhook types we handle
 */
export type LinearWebhook = 
  | LinearIssueAssignedWebhook
  | LinearIssueCommentMentionWebhook
  | LinearIssueNewCommentWebhook
  | LinearIssueUnassignedWebhook
  | LinearAgentSessionCreatedWebhook
  | LinearAgentSessionPromptedWebhook

/**
 * Type guards for webhook discrimination
 */
export function isIssueAssignedWebhook(webhook: LinearWebhook): webhook is LinearIssueAssignedWebhook {
  return webhook.action === 'issueAssignedToYou'
}

export function isIssueCommentMentionWebhook(webhook: LinearWebhook): webhook is LinearIssueCommentMentionWebhook {
  return webhook.action === 'issueCommentMention'
}

export function isIssueNewCommentWebhook(webhook: LinearWebhook): webhook is LinearIssueNewCommentWebhook {
  return webhook.action === 'issueNewComment'
}

export function isIssueUnassignedWebhook(webhook: LinearWebhook): webhook is LinearIssueUnassignedWebhook {
  return webhook.action === 'issueUnassignedFromYou'
}

export function isAgentSessionCreatedWebhook(webhook: LinearWebhook): webhook is LinearAgentSessionCreatedWebhook {
  return webhook.type === 'AgentSessionEvent' && webhook.action === 'created'
}

export function isAgentSessionPromptedWebhook(webhook: LinearWebhook): webhook is LinearAgentSessionPromptedWebhook {
  return webhook.type === 'AgentSessionEvent' && webhook.action === 'prompted'
}