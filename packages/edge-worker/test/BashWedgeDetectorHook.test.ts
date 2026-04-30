import type {
	HookCallbackMatcher,
	PostToolUseHookInput,
} from "cyrus-claude-runner";
import type { ILogger, LogEventAttributes } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { buildBashWedgeDetectorHook } from "../src/hooks/BashWedgeDetectorHook.js";

interface RecordedEvent {
	name: string;
	attributes: LogEventAttributes | undefined;
}

interface RecordedWarn {
	message: string;
}

function makeRecordingLogger(): {
	logger: ILogger;
	events: RecordedEvent[];
	warns: RecordedWarn[];
} {
	const events: RecordedEvent[] = [];
	const warns: RecordedWarn[] = [];
	const logger: Partial<ILogger> = {
		debug: () => {},
		info: () => {},
		warn: (message: string) => {
			warns.push({ message });
		},
		error: () => {},
		event: (name, attributes) => {
			events.push({ name, attributes });
		},
	};
	return { logger: logger as ILogger, events, warns };
}

function makeHookInput(
	toolResponse: unknown,
	overrides: Partial<PostToolUseHookInput> = {},
): PostToolUseHookInput {
	return {
		hook_event_name: "PostToolUse",
		session_id: "session-A",
		transcript_path: "t",
		cwd: "/tmp/repo",
		tool_name: "Bash",
		tool_input: { command: "date" },
		tool_response: toolResponse,
		tool_use_id: "u",
		...overrides,
	} as PostToolUseHookInput;
}

async function runHook(
	matcher: HookCallbackMatcher,
	input: PostToolUseHookInput,
) {
	const fn = matcher.hooks[0];
	return await fn(input as any, "u", { signal: new AbortController().signal });
}

function getMatcher(hooks: ReturnType<typeof buildBashWedgeDetectorHook>) {
	const matchers = hooks.PostToolUse ?? [];
	expect(matchers).toHaveLength(1);
	expect(matchers[0]?.matcher).toBe("Bash");
	return matchers[0] as HookCallbackMatcher;
}

const WEDGE_STDERR = "/bin/bash: line 4: /proc/self/fd/3: Permission denied";

describe("buildBashWedgeDetectorHook", () => {
	it("is a no-op for healthy Bash output", async () => {
		const { logger, events, warns } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		const result = await runHook(
			matcher,
			makeHookInput({
				stdout: "Wed Apr 29 23:30:39 UTC 2026\n",
				stderr: "",
				exit_code: 0,
			}),
		);

		expect(result).toEqual({});
		expect(events).toHaveLength(0);
		expect(warns).toHaveLength(0);
	});

	it("is a no-op when stderr has unrelated errors", async () => {
		const { logger, events } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		const result = await runHook(
			matcher,
			makeHookInput({
				stdout: "",
				stderr: "git: command not found",
				exit_code: 127,
			}),
		);

		expect(result).toEqual({});
		expect(events).toHaveLength(0);
	});

	it("on first detection: warns, emits telemetry, surfaces guidance to model", async () => {
		const { logger, events, warns } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		const result = await runHook(
			matcher,
			makeHookInput({
				stdout: "",
				stderr: WEDGE_STDERR,
				exit_code: 126,
			}),
		);

		expect(warns).toHaveLength(1);
		expect(warns[0].message).toContain("FD-3 wedge detected");
		expect(warns[0].message).toContain("session-A");

		expect(events).toHaveLength(1);
		expect(events[0].name).toBe("bash_fd3_wedge_detected");
		expect(events[0].attributes).toMatchObject({
			sessionId: "session-A",
			exitCode: 126,
			firstHit: true,
		});

		// Result must surface guidance to the model
		expect(result).toMatchObject({ continue: true });
		expect((result as any).additionalContext).toContain(
			"/proc/self/fd/3: Permission denied",
		);
		expect((result as any).additionalContext).toContain("Do NOT retry Bash");
	});

	it("on subsequent detections in same session: telemetry only, no extra guidance", async () => {
		const { logger, events, warns } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		const wedgeInput = makeHookInput({
			stdout: "",
			stderr: WEDGE_STDERR,
			exit_code: 126,
		});

		const first = await runHook(matcher, wedgeInput);
		const second = await runHook(matcher, wedgeInput);
		const third = await runHook(matcher, wedgeInput);

		// First hit returns guidance
		expect((first as any).additionalContext).toBeDefined();
		// Subsequent hits do not (model already has the hint)
		expect(second).toEqual({});
		expect(third).toEqual({});

		// Warn fires only once
		expect(warns).toHaveLength(1);
		// Telemetry fires every time, with firstHit reflecting the state
		expect(events.map((e) => e.attributes?.firstHit)).toEqual([
			true,
			false,
			false,
		]);
	});

	it("dedupes per-session, so a second session gets its own first-hit guidance", async () => {
		const { logger, events, warns } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		const wedgeA = makeHookInput(
			{ stdout: "", stderr: WEDGE_STDERR, exit_code: 126 },
			{ session_id: "session-A" },
		);
		const wedgeB = makeHookInput(
			{ stdout: "", stderr: WEDGE_STDERR, exit_code: 126 },
			{ session_id: "session-B" },
		);

		await runHook(matcher, wedgeA);
		await runHook(matcher, wedgeA);
		const firstB = await runHook(matcher, wedgeB);

		expect(warns).toHaveLength(2); // once per session
		expect((firstB as any).additionalContext).toBeDefined();
		expect(events.map((e) => e.attributes?.sessionId)).toEqual([
			"session-A",
			"session-A",
			"session-B",
		]);
	});

	it("matches the wedge signature even when stderr is in a non-standard field", async () => {
		const { logger, events } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		// Future SDK version might rename the stderr field — we fall back to
		// stringifying the whole tool_response. Make sure that path works.
		const result = await runHook(
			matcher,
			makeHookInput({
				someOtherField: WEDGE_STDERR,
				exitCode: 126,
			}),
		);

		expect((result as any).additionalContext).toBeDefined();
		expect(events).toHaveLength(1);
		expect(events[0].attributes?.exitCode).toBe(126);
	});

	it("handles a null/undefined tool_response without throwing", async () => {
		const { logger } = makeRecordingLogger();
		const matcher = getMatcher(buildBashWedgeDetectorHook(logger));

		await expect(runHook(matcher, makeHookInput(null))).resolves.toEqual({});
		await expect(runHook(matcher, makeHookInput(undefined))).resolves.toEqual(
			{},
		);
	});
});
