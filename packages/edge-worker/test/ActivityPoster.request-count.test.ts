/**
 * Regression tests for the number of Linear requests that one
 * ActivityPoster.postActivityDirect() call issues.
 *
 * postActivityDirect is the second path that posts an agent activity, and it
 * read the created activity back through the same unmemoized SDK getter as
 * LinearActivitySink did. Its try/catch does not make the orphaned read-back
 * safe: the promise produced by the `if` condition is never awaited, so its
 * rejection is not the catch block's to handle.
 */

import type { IIssueTrackerService, ILogger } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPoster } from "../src/ActivityPoster.js";
import {
	countingCreateAgentActivity,
	createAgentActivityPayload,
	createRequestLog,
	type RequestLog,
} from "./agent-activity-payload-double.js";

describe("ActivityPoster request count", () => {
	let poster: ActivityPoster;
	let issueTracker: IIssueTrackerService;
	let createAgentActivity: ReturnType<typeof vi.fn>;
	let logger: ILogger;
	let log: RequestLog;

	const input = {
		agentSessionId: "session-1",
		content: { type: "thought" as const, body: "Analyzing..." },
	};

	const respondWith = (payload: object) => {
		createAgentActivity.mockImplementation(
			countingCreateAgentActivity(log, payload),
		);
	};

	beforeEach(() => {
		log = createRequestLog();
		createAgentActivity = vi.fn();
		issueTracker = { createAgentActivity } as unknown as IIssueTrackerService;
		logger = {
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
		} as unknown as ILogger;

		poster = new ActivityPoster(
			new Map([["workspace-1", issueTracker]]),
			new Map(),
			logger,
		);
	});

	it("should issue exactly one Linear request per posted activity", async () => {
		respondWith(createAgentActivityPayload(log, "activity-1"));

		const activityId = await poster.postActivityDirect(
			issueTracker,
			input,
			"thought",
		);

		expect(activityId).toBe("activity-1");
		expect(log.operations).toEqual(["mutation:agentActivityCreate"]);
	});

	it("should not read the activity back after creating it", async () => {
		respondWith(createAgentActivityPayload(log, "activity-2"));

		await poster.postActivityDirect(issueTracker, input, "thought");

		expect(log.operations).not.toContain("query:agentActivity");
	});

	it("should not orphan a rejected read-back promise", async () => {
		respondWith(
			createAgentActivityPayload(log, "activity-3", { readBackRejects: true }),
		);

		const unhandled: unknown[] = [];
		const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandledRejection);

		try {
			await poster.postActivityDirect(issueTracker, input, "thought");
			// Yield a macrotask so Node can report any rejection left unhandled.
			await new Promise((resolve) => setTimeout(resolve, 10));
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
		}

		expect(unhandled).toEqual([]);
	});

	it("should still return null and log an error when the mutation did not succeed", async () => {
		respondWith({ success: false, lastSyncId: 1 });

		const activityId = await poster.postActivityDirect(
			issueTracker,
			input,
			"thought",
		);

		expect(activityId).toBeNull();
		expect(logger.error).toHaveBeenCalled();
		expect(log.operations).toEqual(["mutation:agentActivityCreate"]);
	});

	it("should still return null when the payload carries no activity id", async () => {
		respondWith({ success: true, lastSyncId: 1, agentActivityId: undefined });

		const activityId = await poster.postActivityDirect(
			issueTracker,
			input,
			"thought",
		);

		expect(activityId).toBeNull();
		expect(logger.error).not.toHaveBeenCalled();
	});
});
