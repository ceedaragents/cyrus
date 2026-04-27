import { NoopErrorReporter } from "cyrus-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({
	init: vi.fn(),
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	flush: vi.fn().mockResolvedValue(true),
	withScope: (cb: (s: unknown) => void) =>
		cb({ setTag: vi.fn(), setExtra: vi.fn(), setUser: vi.fn() }),
}));

import * as Sentry from "@sentry/node";
import { createErrorReporter } from "./createErrorReporter.js";
import { SentryErrorReporter } from "./SentryErrorReporter.js";

describe("createErrorReporter", () => {
	it("returns a NoopErrorReporter when CYRUS_SENTRY_DISABLED is truthy", () => {
		const reporter = createErrorReporter({
			env: { CYRUS_SENTRY_DISABLED: "1", CYRUS_SENTRY_DSN: "https://x@y/1" },
		});
		expect(reporter).toBeInstanceOf(NoopErrorReporter);
		expect(reporter.isEnabled).toBe(false);
		expect(Sentry.init).not.toHaveBeenCalled();
	});

	it("returns a NoopErrorReporter when no DSN is configured", () => {
		const reporter = createErrorReporter({ env: {} });
		expect(reporter).toBeInstanceOf(NoopErrorReporter);
		expect(reporter.isEnabled).toBe(false);
	});

	it.each(["true", "yes", "on", "TRUE", "1"])(
		"treats CYRUS_SENTRY_DISABLED=%s as opt-out",
		(value) => {
			const reporter = createErrorReporter({
				env: {
					CYRUS_SENTRY_DISABLED: value,
					CYRUS_SENTRY_DSN: "https://x@y/1",
				},
			});
			expect(reporter.isEnabled).toBe(false);
		},
	);

	it("returns a SentryErrorReporter when a DSN is provided via env", () => {
		const reporter = createErrorReporter({
			env: { CYRUS_SENTRY_DSN: "https://abc@sentry.io/1" },
			release: "1.2.3",
		});
		expect(reporter).toBeInstanceOf(SentryErrorReporter);
		expect(reporter.isEnabled).toBe(true);
		expect(Sentry.init).toHaveBeenCalledWith(
			expect.objectContaining({
				dsn: "https://abc@sentry.io/1",
				release: "1.2.3",
				environment: "production",
			}),
		);
	});

	it("forwards CYRUS_SENTRY_ENVIRONMENT", () => {
		createErrorReporter({
			env: {
				CYRUS_SENTRY_DSN: "https://abc@sentry.io/1",
				CYRUS_SENTRY_ENVIRONMENT: "staging",
			},
		});
		expect(Sentry.init).toHaveBeenCalledWith(
			expect.objectContaining({ environment: "staging" }),
		);
	});

	it("Noop reporter flush resolves true and no-ops capture methods", async () => {
		const reporter = createErrorReporter({
			env: { CYRUS_SENTRY_DISABLED: "1" },
		});
		expect(() => reporter.captureException(new Error("x"))).not.toThrow();
		expect(() => reporter.captureMessage("hello")).not.toThrow();
		await expect(reporter.flush()).resolves.toBe(true);
	});
});
