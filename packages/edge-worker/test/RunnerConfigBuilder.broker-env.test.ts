// Learning tests for buildGitHubBrokeredEnv — the per-session env vars
// that make sandboxed gh + git unconditionally route through the egress
// proxy. The proxy overwrites the Authorization header at request time;
// these env vars exist purely to satisfy the gh/git "do you have a token?"
// preflight checks without exposing a real one.

import { describe, expect, it } from "vitest";
import {
	buildGitHubBrokeredEnv,
	GITHUB_BROKER_SENTINEL_TOKEN,
	GITHUB_BROKERED_STRIP_ENV_KEYS,
} from "../src/RunnerConfigBuilder.js";

describe("buildGitHubBrokeredEnv: gating", () => {
	it("returns {} when disabled — caller can spread unconditionally", () => {
		expect(buildGitHubBrokeredEnv({ enabled: false })).toEqual({});
	});
});

describe("buildGitHubBrokeredEnv: enabled output shape", () => {
	const env = buildGitHubBrokeredEnv({ enabled: true });

	it("sets GH_TOKEN to the public sentinel constant", () => {
		// Tests should reference the exported constant rather than a string
		// literal — that way a future rename of the sentinel value updates
		// callers consistently.
		expect(env.GH_TOKEN).toBe(GITHUB_BROKER_SENTINEL_TOKEN);
	});

	it("sentinel is non-empty and not in any real GitHub token format", () => {
		// gh CLI fails its auth check on empty tokens. Real GitHub tokens
		// start with `ghp_`, `ghs_`, `gho_`, `github_pat_` — pinning that the
		// sentinel doesn't match any of those, so it can't be confused with
		// a real token in transcripts/logs.
		expect(GITHUB_BROKER_SENTINEL_TOKEN).not.toBe("");
		expect(GITHUB_BROKER_SENTINEL_TOKEN).not.toMatch(/^gh[ps]_/);
		expect(GITHUB_BROKER_SENTINEL_TOKEN).not.toMatch(/^github_pat_/);
		// And it's identifiable as a Cyrus-specific marker.
		expect(GITHUB_BROKER_SENTINEL_TOKEN).toMatch(/cyrus-brokered/i);
	});

	it("sets GIT_TERMINAL_PROMPT=0 to stop git from prompting", () => {
		// If brokering somehow misroutes (corner case in credential helper
		// negotiation), git's default behavior is to open an interactive
		// prompt — which hangs sandboxed processes forever. Disabling the
		// prompt makes a misroute fail loudly instead.
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
	});

	it("registers exactly one credential helper via GIT_CONFIG_COUNT/KEY/VALUE", () => {
		// git-config(1) §"GIT_CONFIG_COUNT": git reads N config entries from
		// env vars, indexed 0..N-1. We only need one — a credential helper
		// for https://github.com.
		expect(env.GIT_CONFIG_COUNT).toBe("1");
		expect(env.GIT_CONFIG_KEY_0).toBe("credential.https://github.com.helper");
		// No stray indices that git would silently read past.
		expect(env.GIT_CONFIG_KEY_1).toBeUndefined();
		expect(env.GIT_CONFIG_VALUE_1).toBeUndefined();
	});

	it("credential helper returns username=x-access-token + password=<sentinel>", () => {
		// The helper protocol: git invokes it as `<helper> get`, helper
		// writes `username=...` and `password=...` lines to stdout. git then
		// builds `Authorization: Basic base64(username:password)`. The proxy
		// MITM-overwrites Authorization with the real value at request time,
		// so the password the helper produces is just the sentinel.
		const helper = env.GIT_CONFIG_VALUE_0;
		expect(helper).toContain("username=x-access-token");
		expect(helper).toContain(`password=${GITHUB_BROKER_SENTINEL_TOKEN}`);
		// The leading `!` tells git "this is a shell snippet, not a binary
		// path". Required for inline helpers.
		expect(helper).toMatch(/^!/);
	});
});

describe("GITHUB_BROKERED_STRIP_ENV_KEYS: env var names that must NOT survive", () => {
	it("covers the three known GitHub-credential env var names", () => {
		// When brokering is on, these are stripped from the session's
		// repositoryEnv (loaded from .env files). If a new GitHub-credential
		// env var name appears upstream, this list needs updating — and a
		// failing test here is the early signal.
		expect([...GITHUB_BROKERED_STRIP_ENV_KEYS].sort()).toEqual(
			["GH_ENTERPRISE_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].sort(),
		);
	});

	it("does NOT include GH_TOKEN_FILE / GITHUB_TOKEN_FILE", () => {
		// Some tooling looks for *_FILE variants pointing at a path. Those
		// don't exist in current GitHub CLI conventions, so we don't strip
		// them — and pinning that absence prevents accidental scope creep.
		expect(GITHUB_BROKERED_STRIP_ENV_KEYS).not.toContain("GH_TOKEN_FILE");
		expect(GITHUB_BROKERED_STRIP_ENV_KEYS).not.toContain("GITHUB_TOKEN_FILE");
	});
});
