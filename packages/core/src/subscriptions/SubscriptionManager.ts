import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createLogger, type ILogger } from "../logging/index.js";
import type {
	CompressMap,
	CreateSubscriptionInput,
	EventDeliveryResult,
	SerializedSubscriptionState,
	Subscription,
	SubscriptionEvent,
} from "./types.js";

/**
 * Manages subscriptions for agent sessions.
 *
 * Subscriptions are stored per-session and matched against incoming events.
 * The manager emits "deliver" events when a subscription matches, allowing
 * the EdgeWorker to handle actual delivery to running sessions.
 */
export class SubscriptionManager extends EventEmitter {
	/** sessionId → Subscription[] */
	private subscriptions = new Map<string, Subscription[]>();
	private logger: ILogger;

	constructor(logger?: ILogger) {
		super();
		this.logger = logger ?? createLogger({ component: "SubscriptionManager" });
	}

	/**
	 * Create a new subscription for a session.
	 */
	createSubscription(
		input: CreateSubscriptionInput & { sessionId: string },
	): Subscription {
		const subscription: Subscription = {
			id: randomUUID(),
			sessionId: input.sessionId,
			eventType: input.eventType ?? "custom",
			filter: input.filter,
			compress: input.compress,
			prompt: input.prompt,
			whileStreamingOnly: input.whileStreamingOnly,
			oneShot: input.oneShot,
			createdAt: Date.now(),
		};

		const sessionSubs = this.subscriptions.get(input.sessionId) ?? [];
		sessionSubs.push(subscription);
		this.subscriptions.set(input.sessionId, sessionSubs);

		this.logger.info(
			`Created subscription ${subscription.id} for session ${input.sessionId}: ${subscription.eventType}`,
		);

		return subscription;
	}

	/**
	 * Remove a subscription by ID.
	 * Returns true if the subscription was found and removed.
	 */
	unsubscribe(subscriptionId: string): boolean {
		for (const [sessionId, subs] of this.subscriptions.entries()) {
			const index = subs.findIndex((s) => s.id === subscriptionId);
			if (index !== -1) {
				subs.splice(index, 1);
				if (subs.length === 0) {
					this.subscriptions.delete(sessionId);
				}
				this.logger.info(
					`Removed subscription ${subscriptionId} from session ${sessionId}`,
				);
				return true;
			}
		}
		this.logger.warn(`Subscription ${subscriptionId} not found`);
		return false;
	}

	/**
	 * Remove all subscriptions for a session.
	 */
	removeSessionSubscriptions(sessionId: string): void {
		const count = this.subscriptions.get(sessionId)?.length ?? 0;
		this.subscriptions.delete(sessionId);
		if (count > 0) {
			this.logger.info(
				`Removed ${count} subscriptions for session ${sessionId}`,
			);
		}
	}

	/**
	 * Get all subscriptions for a session.
	 */
	getSessionSubscriptions(sessionId: string): Subscription[] {
		return this.subscriptions.get(sessionId) ?? [];
	}

	/**
	 * Get a specific subscription by ID.
	 */
	getSubscription(subscriptionId: string): Subscription | undefined {
		for (const subs of this.subscriptions.values()) {
			const sub = subs.find((s) => s.id === subscriptionId);
			if (sub) return sub;
		}
		return undefined;
	}

	/**
	 * Match an event against all subscriptions and return matching results.
	 *
	 * This does NOT deliver events — it returns the list of subscriptions that match.
	 * The caller is responsible for delivery and checking whileStreamingOnly constraints.
	 */
	matchEvent(event: SubscriptionEvent): Array<{
		subscription: Subscription;
		compressedPayload?: Record<string, unknown>;
	}> {
		const matches: Array<{
			subscription: Subscription;
			compressedPayload?: Record<string, unknown>;
		}> = [];

		for (const [_sessionId, subs] of this.subscriptions.entries()) {
			for (const sub of subs) {
				if (this.subscriptionMatchesEvent(sub, event)) {
					const compressedPayload = sub.compress
						? this.applyCompressMap(event.payload, sub.compress)
						: undefined;
					matches.push({ subscription: sub, compressedPayload });
				}
			}
		}

		return matches;
	}

	/**
	 * Process an event: match against subscriptions, emit delivery requests,
	 * and clean up one-shot subscriptions.
	 *
	 * Returns delivery results for each matching subscription.
	 */
	processEvent(
		event: SubscriptionEvent,
		isSessionStreaming: (sessionId: string) => boolean,
	): EventDeliveryResult[] {
		const matches = this.matchEvent(event);
		const results: EventDeliveryResult[] = [];
		const oneShotToRemove: string[] = [];

		for (const { subscription, compressedPayload } of matches) {
			// Check whileStreamingOnly constraint
			if (
				subscription.whileStreamingOnly &&
				!isSessionStreaming(subscription.sessionId)
			) {
				results.push({
					subscriptionId: subscription.id,
					sessionId: subscription.sessionId,
					delivered: false,
					reason: "session_not_streaming",
				});
				continue;
			}

			// Emit delivery event for the EdgeWorker to handle
			this.emit("deliver", {
				subscription,
				event,
				compressedPayload,
			});

			results.push({
				subscriptionId: subscription.id,
				sessionId: subscription.sessionId,
				delivered: true,
			});

			// Mark one-shot subscriptions for removal
			if (subscription.oneShot) {
				oneShotToRemove.push(subscription.id);
			}
		}

		// Clean up one-shot subscriptions
		for (const id of oneShotToRemove) {
			this.unsubscribe(id);
		}

		return results;
	}

	/**
	 * Check if a subscription matches an event.
	 */
	private subscriptionMatchesEvent(
		subscription: Subscription,
		event: SubscriptionEvent,
	): boolean {
		// Event type must match
		if (subscription.eventType !== event.eventType) {
			return false;
		}

		// If no filter, match all events of this type
		if (!subscription.filter) {
			return true;
		}

		// All filter conditions must match
		for (const [key, filterValue] of Object.entries(subscription.filter)) {
			const eventValue = event.filterableProperties[key];

			if (eventValue === undefined) {
				return false;
			}

			// Array filter: event value must be one of the filter values
			if (Array.isArray(filterValue)) {
				if (Array.isArray(eventValue)) {
					// Both arrays: check for intersection
					if (
						!filterValue.some((fv) => (eventValue as string[]).includes(fv))
					) {
						return false;
					}
				} else {
					// Filter is array, event is scalar: event value must be in filter
					if (!filterValue.includes(String(eventValue))) {
						return false;
					}
				}
			} else {
				// Scalar filter: must match exactly
				if (String(eventValue) !== String(filterValue)) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * Apply a compress map to extract specific fields from a payload.
	 */
	private applyCompressMap(
		payload: Record<string, unknown>,
		compress: CompressMap,
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [outputKey, path] of Object.entries(compress)) {
			result[outputKey] = this.getNestedValue(payload, path);
		}
		return result;
	}

	/**
	 * Get a value from a nested object using a dot-separated path.
	 */
	private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
		const parts = path.split(".");
		let current: unknown = obj;
		for (const part of parts) {
			if (current == null || typeof current !== "object") {
				return undefined;
			}
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}

	/**
	 * Serialize subscription state for persistence.
	 */
	serializeState(): SerializedSubscriptionState {
		const subscriptions: Record<string, Subscription[]> = {};
		for (const [sessionId, subs] of this.subscriptions.entries()) {
			subscriptions[sessionId] = subs;
		}
		return { subscriptions };
	}

	/**
	 * Restore subscription state from persisted data.
	 */
	restoreState(state: SerializedSubscriptionState): void {
		this.subscriptions.clear();
		if (state.subscriptions) {
			for (const [sessionId, subs] of Object.entries(state.subscriptions)) {
				this.subscriptions.set(sessionId, subs);
			}
		}
		this.logger.info(
			`Restored ${this.subscriptions.size} session subscription lists`,
		);
	}

	/**
	 * Auto-subscribe a session to default events based on configuration.
	 */
	autoSubscribe(
		sessionId: string,
		options: {
			issueId?: string;
			issueUpdateEnabled?: boolean;
			baseBranches?: Array<{ repositoryId: string; branch: string }>;
		},
	): Subscription[] {
		const created: Subscription[] = [];

		// Auto-subscribe to prompted events for this session
		created.push(
			this.createSubscription({
				sessionId,
				eventType: "prompted",
				filter: { sessionId },
			}),
		);

		// Auto-subscribe to issue updates if enabled
		if (options.issueUpdateEnabled !== false && options.issueId) {
			created.push(
				this.createSubscription({
					sessionId,
					eventType: "issue_updated",
					filter: {
						issueId: options.issueId,
						field: ["title", "description", "attachments"],
					},
					whileStreamingOnly: true,
					compress: {
						field: "field",
						previousValue: "previousValue",
						newValue: "newValue",
					},
				}),
			);
		}

		// Auto-subscribe to base branch updates for each routed repository
		if (options.baseBranches) {
			for (const { repositoryId, branch } of options.baseBranches) {
				created.push(
					this.createSubscription({
						sessionId,
						eventType: "base_branch_updated",
						filter: { repositoryId, branch },
						prompt:
							"The base branch has new commits. Consider rebasing if you are at a good stopping point, or after completing your current task.",
					}),
				);
			}
		}

		this.logger.info(
			`Auto-subscribed session ${sessionId} to ${created.length} events`,
		);

		return created;
	}

	/**
	 * Get total subscription count across all sessions.
	 */
	get totalSubscriptionCount(): number {
		let count = 0;
		for (const subs of this.subscriptions.values()) {
			count += subs.length;
		}
		return count;
	}
}
