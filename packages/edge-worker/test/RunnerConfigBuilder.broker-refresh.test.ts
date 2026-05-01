// Learning tests for refreshGitHubBrokerPolicy — the dispatch logic that
// EdgeWorker calls to (re)push the brokered policy onto the proxy.
//
// The function is pure-ish: caller threads in `prevToken` and
// `warningEmittedAlready`, and the function returns the new state for the
// caller to persist. No internal state, no EdgeWorker instance needed —
// every branch is testable with a small fixture object.

import type { NetworkPolicy } from "cyrus-core";
import { describe, expect, it, vi } from "vitest";
import { refreshGitHubBrokerPolicy } from "../src/RunnerConfigBuilder.js";

const TOKEN_A = "ghs_token_a";
const TOKEN_B = "ghs_token_b";

interface Spies {
	pushPolicy: ReturnType<typeof vi.fn>;
	emitWarning: ReturnType<typeof vi.fn>;
	emitInfo: ReturnType<typeof vi.fn>;
}

function makeSpies(): Spies {
	return {
		pushPolicy: vi.fn(),
		emitWarning: vi.fn(),
		emitInfo: vi.fn(),
	};
}

describe("refreshGitHubBrokerPolicy: brokering disabled", () => {
	it("short-circuits when brokerEnabled is false — no resolver call, no push", async () => {
		const spies = makeSpies();
		const resolveToken = vi.fn();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: false,
			basePolicy: undefined,
			resolveToken,
			pushPolicy: spies.pushPolicy,
			prevToken: null,
			warningEmittedAlready: false,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(result).toEqual({ newToken: null, warningEmittedNow: false });
		expect(resolveToken).not.toHaveBeenCalled();
		expect(spies.pushPolicy).not.toHaveBeenCalled();
		expect(spies.emitWarning).not.toHaveBeenCalled();
		expect(spies.emitInfo).not.toHaveBeenCalled();
	});
});

describe("refreshGitHubBrokerPolicy: no token resolvable", () => {
	it("emits WARN once when warningEmittedAlready is false", async () => {
		const spies = makeSpies();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: undefined,
			resolveToken: async () => undefined,
			pushPolicy: spies.pushPolicy,
			prevToken: null,
			warningEmittedAlready: false,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(spies.emitWarning).toHaveBeenCalledTimes(1);
		expect(spies.pushPolicy).not.toHaveBeenCalled();
		// Latch persists in the result so caller stores it.
		expect(result).toEqual({ newToken: null, warningEmittedNow: true });
	});

	it("does NOT re-emit WARN when warningEmittedAlready is true", async () => {
		const spies = makeSpies();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: undefined,
			resolveToken: async () => undefined,
			pushPolicy: spies.pushPolicy,
			prevToken: null,
			warningEmittedAlready: true,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(spies.emitWarning).not.toHaveBeenCalled();
		expect(result).toEqual({ newToken: null, warningEmittedNow: true });
	});
});

describe("refreshGitHubBrokerPolicy: token resolution and push", () => {
	it("on first resolution: pushes a brokered policy + emits info", async () => {
		const spies = makeSpies();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: undefined,
			resolveToken: async () => TOKEN_A,
			pushPolicy: spies.pushPolicy,
			prevToken: null,
			warningEmittedAlready: false,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(spies.pushPolicy).toHaveBeenCalledTimes(1);
		expect(spies.emitInfo).toHaveBeenCalledTimes(1);
		expect(spies.emitWarning).not.toHaveBeenCalled();

		const pushedPolicy = spies.pushPolicy.mock.calls[0][0] as NetworkPolicy;
		// Sanity: the pushed policy has the brokered domains.
		expect(pushedPolicy.allow?.["api.github.com"]).toBeDefined();
		expect(pushedPolicy.allow?.["github.com"]).toBeDefined();

		expect(result).toEqual({ newToken: TOKEN_A, warningEmittedNow: false });
	});

	it("on unchanged token: skips the push (idempotent refresh)", async () => {
		// Periodic refresh tick when the App-token cache hasn't rotated. We
		// don't want to spam updateNetworkPolicy with identical content.
		const spies = makeSpies();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: undefined,
			resolveToken: async () => TOKEN_A,
			pushPolicy: spies.pushPolicy,
			prevToken: TOKEN_A,
			warningEmittedAlready: false,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(spies.pushPolicy).not.toHaveBeenCalled();
		expect(spies.emitInfo).not.toHaveBeenCalled();
		expect(result).toEqual({ newToken: TOKEN_A, warningEmittedNow: false });
	});

	it("on token rotation: pushes a fresh policy", async () => {
		const spies = makeSpies();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: undefined,
			resolveToken: async () => TOKEN_B,
			pushPolicy: spies.pushPolicy,
			prevToken: TOKEN_A,
			warningEmittedAlready: false,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(spies.pushPolicy).toHaveBeenCalledTimes(1);
		const pushed = spies.pushPolicy.mock.calls[0][0] as NetworkPolicy;
		// New token shows up in the Bearer header for api.github.com.
		expect(
			pushed.allow!["api.github.com"]![0]!.transform![0]!.headers.Authorization,
		).toBe(`Bearer ${TOKEN_B}`);
		expect(result.newToken).toBe(TOKEN_B);
	});

	it("on token recovery (was missing, now resolves): clears the WARN latch", async () => {
		// Sequence: previous refresh had no token, WARN fired, latch=true.
		// New refresh resolves a token. Future "no token" should re-WARN —
		// so the returned latch must be false.
		const spies = makeSpies();

		const result = await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: undefined,
			resolveToken: async () => TOKEN_A,
			pushPolicy: spies.pushPolicy,
			prevToken: null,
			warningEmittedAlready: true,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		expect(result.warningEmittedNow).toBe(false);
		expect(spies.pushPolicy).toHaveBeenCalledTimes(1);
	});

	it("composes brokered transforms onto a user-supplied basePolicy", async () => {
		// EdgeWorker passes `config.sandbox.networkPolicy` as basePolicy. The
		// helper must preserve any unrelated allows the user configured.
		const spies = makeSpies();
		const base: NetworkPolicy = {
			allow: {
				"registry.npmjs.org": [{}],
			},
		};

		await refreshGitHubBrokerPolicy({
			brokerEnabled: true,
			basePolicy: base,
			resolveToken: async () => TOKEN_A,
			pushPolicy: spies.pushPolicy,
			prevToken: null,
			warningEmittedAlready: false,
			emitWarning: spies.emitWarning,
			emitInfo: spies.emitInfo,
		});

		const pushed = spies.pushPolicy.mock.calls[0][0] as NetworkPolicy;
		expect(pushed.allow?.["registry.npmjs.org"]).toEqual([{}]);
		expect(pushed.allow?.["api.github.com"]).toBeDefined();
		expect(pushed.allow?.["github.com"]).toBeDefined();
	});
});
