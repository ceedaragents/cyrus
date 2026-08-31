/**
 * A test double for @linear/sdk's AgentActivityPayload that preserves the
 * property shapes the edge worker actually reads, and a request counter to
 * observe what those reads cost.
 *
 * The ordinary mocks elsewhere in this suite model
 * `AgentActivityPayload.agentActivity` as a plain, already-resolved promise
 * property. The real payload models it as an *unmemoized getter* (generated SDK
 * v64):
 *
 *   get agentActivity(): LinearFetch<AgentActivity> | undefined {
 *     return new AgentActivityQuery(this._request).fetch(this._agentActivity.id);
 *   }
 *   get agentActivityId(): string | undefined {
 *     return this._agentActivity?.id;
 *   }
 *
 * Every access of `agentActivity` constructs a fresh query and issues another
 * round trip; `agentActivityId` reads an id the mutation response already
 * carries, at no request cost. A property mock cannot tell the two apart, so
 * the getter is reproduced here.
 */

/** Records every Linear round trip issued during a call under test. */
export interface RequestLog {
	operations: string[];
}

export const createRequestLog = (): RequestLog => ({ operations: [] });

export interface AgentActivityPayloadDoubleOptions {
	/** Make the activity read-back fail, as it does once the budget is spent. */
	readBackRejects?: boolean;
}

/**
 * Build a payload double that counts each `agentActivity` access as one query
 * and charges nothing for `agentActivityId`.
 */
export function createAgentActivityPayload(
	log: RequestLog,
	activityId: string,
	options: AgentActivityPayloadDoubleOptions = {},
) {
	return {
		success: true,
		lastSyncId: 1,
		get agentActivity(): Promise<{ id: string }> {
			log.operations.push("query:agentActivity");
			return options.readBackRejects
				? Promise.reject(new Error("Ratelimit exceeded"))
				: Promise.resolve({ id: activityId });
		},
		get agentActivityId(): string | undefined {
			return activityId;
		},
	};
}

/**
 * A `createAgentActivity` implementation that counts the mutation itself, so
 * the request count for a call under test is `log.operations.length`.
 *
 * Measurement method: the counter sits on the transport, not on the caller.
 * Each operation that would reach Linear appends exactly one entry -- the
 * agentActivityCreate mutation here, and one agentActivity read-back query per
 * access of the unmemoized getter above.
 */
export function countingCreateAgentActivity(log: RequestLog, payload: object) {
	return async () => {
		log.operations.push("mutation:agentActivityCreate");
		return payload as any;
	};
}
