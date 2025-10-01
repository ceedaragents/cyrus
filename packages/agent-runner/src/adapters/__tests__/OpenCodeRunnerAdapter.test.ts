import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerEvent } from "../../types.ts";
import { OpenCodeRunnerAdapter } from "../OpenCodeRunnerAdapter.ts";

const fetchMock = vi.fn<typeof fetch>();

const createOkResponse = (overrides: Partial<Response> = {}): Response =>
	({
		ok: true,
		status: 200,
		statusText: "OK",
		json: async () => ({}),
		...overrides,
	}) as Response;

const createSseResponse = (chunks: string[]): Response => {
	const encoder = new TextEncoder();
	let index = 0;

	return createOkResponse({
		body: {
			getReader() {
				return {
					async read() {
						if (index >= chunks.length) {
							return { done: true, value: undefined };
						}
						const value = encoder.encode(chunks[index]);
						index += 1;
						return { done: false, value };
					},
					async cancel() {
						// no-op
					},
					releaseLock() {
						// no-op
					},
				};
			},
		},
	} as Partial<Response> as Response);
};

const flushAsync = async (): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
};

describe("OpenCodeRunnerAdapter", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("emits normalized events from OpenCode SSE stream", async () => {
		fetchMock
			.mockResolvedValueOnce(createOkResponse())
			.mockResolvedValueOnce(
				createOkResponse({
					json: async () => ({ id: "session-42" }),
				}),
			)
			.mockResolvedValueOnce(createOkResponse())
			.mockResolvedValueOnce(
				createSseResponse([
					`data: ${JSON.stringify({
						properties: { sessionID: "session-42" },
						message: {
							parts: [
								{ type: "text", text: "  first thought  " },
								{
									type: "tool_use",
									name: "shell",
									input: { command: "ls" },
								},
							],
						},
					})}\n\n`,
				]),
			);

		const adapter = new OpenCodeRunnerAdapter({
			type: "opencode",
			cwd: "/tmp/workspace",
			prompt: "list files",
			serverUrl: "http://localhost:17899",
			openaiApiKey: "test-key",
			model: "gpt",
			provider: "openai",
		});

		const events: RunnerEvent[] = [];
		const startResult = await adapter.start((event) => {
			events.push(event);
		});

		expect(startResult.sessionId).toBe("session-42");
		expect(fetchMock).toHaveBeenCalledTimes(4);

		const authCall = fetchMock.mock.calls[0];
		expect(authCall?.[0]).toBe("http://localhost:17899/auth/openai");

		const sessionCall = fetchMock.mock.calls[1];
		expect(String(sessionCall?.[0])).toBe(
			"http://localhost:17899/session?directory=%2Ftmp%2Fworkspace",
		);

		const commandCall = fetchMock.mock.calls[2];
		expect(String(commandCall?.[0])).toBe(
			"http://localhost:17899/session/session-42/command?directory=%2Ftmp%2Fworkspace",
		);

		const eventCall = fetchMock.mock.calls[3];
		expect(eventCall?.[0]).toBe("http://localhost:17899/event");

		await flushAsync();
		await flushAsync();

		const kinds = events.map((event) => event.kind);
		expect(kinds).toEqual(["thought", "action", "final"]);

		const thoughtEvent = events[0] as { kind: "thought"; text: string };
		expect(thoughtEvent.text).toBe("first thought");

		const actionEvent = events[1] as {
			kind: "action";
			name: string;
			detail?: string;
		};
		expect(actionEvent.name).toBe("shell");
		expect(actionEvent.detail).toContain('"command": "ls"');

		const finalEvent = events[2] as { kind: "final"; text: string };
		expect(finalEvent.text).toBe("OpenCode run completed");

		for (const event of events) {
			expect(["thought", "action", "final"].includes(event.kind)).toBe(true);
		}
	});
});
