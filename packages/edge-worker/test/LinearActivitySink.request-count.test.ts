/**
 * Regression tests for the number of Linear requests that one
 * LinearActivitySink.postActivity() call issues.
 *
 * These live in their own file because they need a different test double from
 * the one in LinearActivitySink.test.ts: the payload has to reproduce the SDK's
 * unmemoized `agentActivity` getter before the cost of touching it twice is
 * observable at all. See ./agent-activity-payload-double.ts.
 */

import type { AgentActivityContent, IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinearActivitySink } from "../src/sinks/LinearActivitySink.js";
import {
	countingCreateAgentActivity,
	createAgentActivityPayload,
	createRequestLog,
	type RequestLog,
} from "./agent-activity-payload-double.js";

describe("LinearActivitySink request count", () => {
	let sink: LinearActivitySink;
	let mockIssueTracker: IIssueTrackerService;
	let log: RequestLog;

	const mockWorkspaceId = "workspace-123";
	const mockSessionId = "session-456";

	const activity: AgentActivityContent = {
		type: "thought",
		body: "Analyzing the codebase...",
	};

	const respondWith = (payload: object) => {
		vi.mocked(mockIssueTracker.createAgentActivity).mockImplementation(
			countingCreateAgentActivity(log, payload),
		);
	};

	beforeEach(() => {
		log = createRequestLog();
		mockIssueTracker = {
			createAgentActivity: vi.fn(),
			createAgentSessionOnIssue: vi.fn(),
		} as unknown as IIssueTrackerService;

		sink = new LinearActivitySink(mockIssueTracker, mockWorkspaceId);
	});

	it("should issue exactly one Linear request per posted activity", async () => {
		respondWith(createAgentActivityPayload(log, "activity-1"));

		const result = await sink.postActivity(mockSessionId, activity);

		expect(result).toEqual({ activityId: "activity-1" });
		expect(log.operations).toEqual(["mutation:agentActivityCreate"]);
		expect(log.operations).toHaveLength(1);
	});

	it("should not read the activity back after creating it", async () => {
		respondWith(createAgentActivityPayload(log, "activity-2"));

		await sink.postActivity(mockSessionId, activity);

		expect(log.operations).not.toContain("query:agentActivity");
	});

	it("should issue one request per activity across a burst of posts", async () => {
		respondWith(createAgentActivityPayload(log, "activity-3"));

		await sink.postActivity(mockSessionId, activity);
		await sink.postActivity(mockSessionId, activity);
		await sink.postActivity(mockSessionId, activity);

		expect(log.operations).toHaveLength(3);
	});

	it("should not orphan a rejected read-back promise", async () => {
		// The getter access in the `if` condition produced a promise that nobody
		// awaited. When that read-back failed -- which is exactly what happens
		// once the extra requests have exhausted the rate-limit budget -- its
		// rejection was unhandled.
		respondWith(
			createAgentActivityPayload(log, "activity-4", { readBackRejects: true }),
		);

		const unhandled: unknown[] = [];
		const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandledRejection);

		try {
			await sink.postActivity(mockSessionId, activity).catch(() => undefined);
			// Yield a macrotask so Node can report any rejection left unhandled.
			await new Promise((resolve) => setTimeout(resolve, 10));
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
		}

		expect(unhandled).toEqual([]);
	});

	it("should still return an empty result when the mutation did not succeed", async () => {
		respondWith({ success: false, lastSyncId: 1 });

		const result = await sink.postActivity(mockSessionId, activity);

		expect(result).toEqual({});
		expect(log.operations).toEqual(["mutation:agentActivityCreate"]);
	});

	it("should still return an empty result when the payload carries no activity id", async () => {
		respondWith({
			success: true,
			lastSyncId: 1,
			agentActivityId: undefined,
		});

		const result = await sink.postActivity(mockSessionId, activity);

		expect(result).toEqual({});
	});
});
