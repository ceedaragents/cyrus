import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, LogLevel } from "../../src/logging/index.js";

// Matches ISO timestamp prefix like "2026-04-01T17:25:59.179Z "
const TS = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z ";

describe("Logger", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.CYRUS_LOG_LEVEL;
	});

	describe("level filtering", () => {
		it("filters out messages below the configured level", () => {
			const logger = createLogger({
				component: "Test",
				level: LogLevel.WARN,
			});
			logger.debug("debug msg");
			logger.info("info msg");
			logger.warn("warn msg");
			logger.error("error msg");

			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledTimes(1);
		});

		it("defaults to INFO level", () => {
			const logger = createLogger({ component: "Test" });
			logger.debug("debug msg");
			logger.info("info msg");

			expect(logSpy).toHaveBeenCalledTimes(1);
			expect(logSpy.mock.calls[0]![0]).toContain("info msg");
		});

		it("SILENT suppresses all output", () => {
			const logger = createLogger({
				component: "Test",
				level: LogLevel.SILENT,
			});
			logger.debug("d");
			logger.info("i");
			logger.warn("w");
			logger.error("e");

			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).not.toHaveBeenCalled();
			expect(errorSpy).not.toHaveBeenCalled();
		});

		it("DEBUG shows all messages", () => {
			const logger = createLogger({
				component: "Test",
				level: LogLevel.DEBUG,
			});
			logger.debug("d");
			logger.info("i");
			logger.warn("w");
			logger.error("e");

			expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe("output formatting", () => {
		it("includes level label and component name", () => {
			const logger = createLogger({
				component: "EdgeWorker",
				level: LogLevel.DEBUG,
			});
			logger.info("Starting up");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[INFO ] \\[EdgeWorker] Starting up$`),
				),
			);
		});

		it("uses console.warn for warn level", () => {
			const logger = createLogger({
				component: "Router",
				level: LogLevel.DEBUG,
			});
			logger.warn("Missing config");

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[WARN ] \\[Router] Missing config$`),
				),
			);
		});

		it("uses console.error for error level", () => {
			const logger = createLogger({
				component: "Runner",
				level: LogLevel.DEBUG,
			});
			logger.error("Fatal crash");

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[ERROR] \\[Runner] Fatal crash$`),
				),
			);
		});

		it("passes extra args through to console", () => {
			const logger = createLogger({
				component: "Test",
				level: LogLevel.DEBUG,
			});
			const extra = { key: "value" };
			logger.info("Message", extra);

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(new RegExp(`^${TS}\\[INFO ] \\[Test] Message$`)),
				extra,
			);
		});
	});

	describe("binding formatting", () => {
		it("includes bindings block when bindings are set", () => {
			const logger = createLogger({
				component: "EdgeWorker",
				level: LogLevel.DEBUG,
				bindings: {
					sessionId: "abc12345-full-uuid-here",
					platform: "linear",
					issueIdentifier: "CYPACK-456",
				},
			});
			logger.info("AI routing decision");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[EdgeWorker] \\{session=abc12345, platform=linear, issue=CYPACK-456\\} AI routing decision$`,
					),
				),
			);
		});

		it("abbreviates session ID to first 8 characters", () => {
			const logger = createLogger({
				component: "Test",
				bindings: { sessionId: "abcdefgh-ijkl-mnop" },
			});
			logger.info("test");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[INFO ] \\[Test] \\{session=abcdefgh\\} test$`),
				),
			);
		});

		it("omits bindings block when no bindings are set", () => {
			const logger = createLogger({ component: "Test" });
			logger.info("no context");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[INFO ] \\[Test] no context$`),
				),
			);
		});

		it("includes repository when set", () => {
			const logger = createLogger({
				component: "Test",
				bindings: { repository: "my-repo" },
			});
			logger.info("msg");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[INFO ] \\[Test] \\{repo=my-repo\\} msg$`),
				),
			);
		});
	});

	describe("withContext()", () => {
		it("returns a new logger with merged bindings", () => {
			const parent = createLogger({
				component: "EdgeWorker",
				level: LogLevel.DEBUG,
				bindings: { platform: "linear" },
			});

			const child = parent.withContext({
				sessionId: "sess1234-abcd",
				issueIdentifier: "DEF-1",
			});

			child.info("Processing");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[EdgeWorker] \\{session=sess1234, platform=linear, issue=DEF-1\\} Processing$`,
					),
				),
			);
		});

		it("does not modify the parent logger", () => {
			const parent = createLogger({
				component: "Test",
				bindings: { platform: "cli" },
			});

			parent.withContext({ sessionId: "abc12345" });
			parent.info("unchanged");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[INFO ] \\[Test] \\{platform=cli\\} unchanged$`),
				),
			);
		});

		it("overrides existing bindings values", () => {
			const logger = createLogger({
				component: "Test",
				bindings: { platform: "linear", repository: "old" },
			});

			const updated = logger.withContext({ repository: "new" });
			updated.info("check");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[Test] \\{platform=linear, repo=new\\} check$`,
					),
				),
			);
		});

		it("preserves the log level from parent", () => {
			const parent = createLogger({
				component: "Test",
				level: LogLevel.WARN,
			});

			const child = parent.withContext({ sessionId: "abc12345" });
			child.info("should be filtered");
			child.warn("should show");

			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe("child()", () => {
		it("returns a logger with a new component name", () => {
			const parent = createLogger({
				component: "EdgeWorker",
				bindings: { platform: "linear" },
			});
			const child = parent.child("SubComp");
			child.info("hello");

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[SubComp] \\{platform=linear\\} hello$`,
					),
				),
			);
		});

		it("inherits level and bindings from parent", () => {
			const parent = createLogger({
				component: "Root",
				level: LogLevel.WARN,
				bindings: { repository: "my-repo" },
			});
			const child = parent.child("Child");
			child.info("filtered");
			child.warn("visible");

			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(`^${TS}\\[WARN ] \\[Child] \\{repo=my-repo\\} visible$`),
				),
			);
		});
	});

	describe("runWithContext()", () => {
		it("attaches bindings to records emitted from within the callback", () => {
			const logger = createLogger({
				component: "EdgeWorker",
				level: LogLevel.DEBUG,
			});

			logger.runWithContext(
				{ sessionId: "scope1234-abcd", issueIdentifier: "ABC-1" },
				() => {
					logger.info("scoped");
				},
			);

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[EdgeWorker] \\{session=scope123, issue=ABC-1\\} scoped$`,
					),
				),
			);
		});

		it("does not leak bindings outside the callback scope", () => {
			const logger = createLogger({ component: "Test" });
			logger.runWithContext({ sessionId: "scope1234" }, () => {
				logger.info("inside");
			});
			logger.info("outside");

			expect(logSpy).toHaveBeenNthCalledWith(
				1,
				expect.stringMatching(
					new RegExp(`^${TS}\\[INFO ] \\[Test] \\{session=scope123\\} inside$`),
				),
			);
			expect(logSpy).toHaveBeenNthCalledWith(
				2,
				expect.stringMatching(new RegExp(`^${TS}\\[INFO ] \\[Test] outside$`)),
			);
		});

		it("merges with static bindings, scope wins on key collision", () => {
			const logger = createLogger({
				component: "Test",
				bindings: { platform: "linear", repository: "outer" },
			});

			logger.runWithContext({ repository: "scoped" }, () => {
				logger.info("merged");
			});

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[Test] \\{platform=linear, repo=scoped\\} merged$`,
					),
				),
			);
		});

		it("nested scopes contribute their bindings additively", () => {
			const logger = createLogger({ component: "Test" });

			logger.runWithContext({ platform: "linear" }, () => {
				logger.runWithContext({ sessionId: "n1234567" }, () => {
					logger.info("nested");
				});
			});

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[Test] \\{session=n1234567, platform=linear\\} nested$`,
					),
				),
			);
		});

		it("propagates scope across awaits", async () => {
			const logger = createLogger({ component: "Test" });

			await logger.runWithContext({ sessionId: "await123" }, async () => {
				await Promise.resolve();
				logger.info("after await");
			});

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					new RegExp(
						`^${TS}\\[INFO ] \\[Test] \\{session=await123\\} after await$`,
					),
				),
			);
		});
	});

	describe("setLevel() and getLevel()", () => {
		it("allows changing the log level at runtime", () => {
			const logger = createLogger({
				component: "Test",
				level: LogLevel.INFO,
			});

			expect(logger.getLevel()).toBe(LogLevel.INFO);

			logger.setLevel(LogLevel.DEBUG);
			expect(logger.getLevel()).toBe(LogLevel.DEBUG);

			logger.debug("now visible");
			expect(logSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe("CYRUS_LOG_LEVEL environment variable", () => {
		it("respects CYRUS_LOG_LEVEL=DEBUG", () => {
			process.env.CYRUS_LOG_LEVEL = "DEBUG";
			const logger = createLogger({ component: "Test" });
			logger.debug("visible");

			expect(logSpy).toHaveBeenCalledTimes(1);
		});

		it("respects CYRUS_LOG_LEVEL=WARN", () => {
			process.env.CYRUS_LOG_LEVEL = "WARN";
			const logger = createLogger({ component: "Test" });
			logger.info("filtered");
			logger.warn("visible");

			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledTimes(1);
		});

		it("is case-insensitive", () => {
			process.env.CYRUS_LOG_LEVEL = "debug";
			const logger = createLogger({ component: "Test" });
			logger.debug("visible");

			expect(logSpy).toHaveBeenCalledTimes(1);
		});

		it("explicit level option overrides env var", () => {
			process.env.CYRUS_LOG_LEVEL = "DEBUG";
			const logger = createLogger({
				component: "Test",
				level: LogLevel.ERROR,
			});
			logger.debug("filtered");
			logger.info("filtered");
			logger.warn("filtered");

			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).not.toHaveBeenCalled();
		});

		it("falls back to INFO for unrecognized values", () => {
			process.env.CYRUS_LOG_LEVEL = "FOOBAR";
			const logger = createLogger({ component: "Test" });
			logger.debug("filtered");
			logger.info("visible");

			expect(logSpy).toHaveBeenCalledTimes(1);
		});
	});
});
