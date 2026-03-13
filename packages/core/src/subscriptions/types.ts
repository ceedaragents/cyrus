/**
 * Subscription system types.
 *
 * Subscriptions allow agent sessions to receive notifications when events occur.
 * Sessions can auto-subscribe to certain events on creation and dynamically
 * subscribe/unsubscribe during their lifetime.
 */

/**
 * Supported event types that can be subscribed to.
 */
export type SubscriptionEventType =
	| "issue_updated"
	| "prompted"
	| "base_branch_updated"
	| "ci_completed"
	| "pull_request_review"
	| "issue_comment"
	| "custom";

/**
 * Source platform for events.
 */
export type EventSource = "linear" | "github" | "slack" | "system";

/**
 * A filter that determines whether a subscription matches a given event.
 * Filters are key-value pairs where the event payload must match all specified values.
 *
 * Examples:
 * - { issueId: "abc123" } — only events for this issue
 * - { field: "title" } — only title-change events
 * - { sessionId: "sess-1" } — only events for this session
 */
export type SubscriptionFilter = Record<string, string | string[] | boolean>;

/**
 * A map defining which fields to extract from the full event payload
 * to create a compressed summary for injection into the agent's context.
 *
 * Keys are the output field names, values are dot-separated paths into the payload.
 * Example: { "title": "data.title", "author": "data.actor.name" }
 */
export type CompressMap = Record<string, string>;

/**
 * A subscription that links an agent session to an event type with optional filtering.
 */
export interface Subscription {
	/** Unique identifier for this subscription */
	id: string;

	/** The agent session that will receive matching events */
	sessionId: string;

	/** The type of event to subscribe to */
	eventType: SubscriptionEventType;

	/** Optional filter to narrow which events match */
	filter?: SubscriptionFilter;

	/** Optional map for compressing the event payload before delivery */
	compress?: CompressMap;

	/** Optional prompt to include when delivering the event to the session */
	prompt?: string;

	/**
	 * If true, events are only delivered while the session's runner is actively streaming.
	 * Events arriving when the session is idle are silently dropped.
	 */
	whileStreamingOnly?: boolean;

	/**
	 * If true, the subscription is automatically removed after the first matching event
	 * is delivered. Useful for "wait once for" semantics (e.g., CI completion).
	 */
	oneShot?: boolean;

	/** When this subscription was created */
	createdAt: number;
}

/**
 * Input for creating a new subscription. Session ID defaults to the current session.
 */
export interface CreateSubscriptionInput {
	eventType?: SubscriptionEventType;
	filter?: SubscriptionFilter;
	compress?: CompressMap;
	prompt?: string;
	whileStreamingOnly?: boolean;
	oneShot?: boolean;
	sessionId?: string;
}

/**
 * A stored event with full payload, written to disk for later retrieval.
 */
export interface StoredEvent {
	/** Unique event ID */
	id: string;

	/** The event type */
	eventType: SubscriptionEventType;

	/** Source platform */
	source: EventSource;

	/** Full raw event payload */
	payload: Record<string, unknown>;

	/** When this event was received */
	receivedAt: number;

	/** Optional compressed summary (if a compress map was applied) */
	compressedPayload?: Record<string, unknown>;
}

/**
 * An event ready to be matched against subscriptions.
 */
export interface SubscriptionEvent {
	/** Unique event ID */
	id: string;

	/** The event type */
	eventType: SubscriptionEventType;

	/** Source platform */
	source: EventSource;

	/** Full event payload */
	payload: Record<string, unknown>;

	/** Filterable properties (flattened from payload for efficient matching) */
	filterableProperties: Record<string, string | string[] | boolean>;
}

/**
 * Result of delivering an event to a subscription.
 */
export interface EventDeliveryResult {
	subscriptionId: string;
	sessionId: string;
	delivered: boolean;
	reason?: string;
}

/**
 * Serializable subscription state for persistence.
 */
export interface SerializedSubscriptionState {
	subscriptions: Record<string, Subscription[]>;
}
