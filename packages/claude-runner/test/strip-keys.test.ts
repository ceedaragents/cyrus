// Learning tests for `stripKeys` — the env filter applied at the merge step
// in ClaudeRunner. Used by the GitHub credential brokering path to remove
// real `GITHUB_TOKEN` / `GH_TOKEN` values from `repositoryEnv` (loaded from
// the worktree's .env) before they reach the child process.

import { describe, expect, it } from "vitest";
import { stripKeys } from "../src/ClaudeRunner.js";

describe("stripKeys: identity behavior when nothing to strip", () => {
	it("returns the input unchanged when keysToStrip is undefined", () => {
		const env = { A: "1", B: "2" };
		expect(stripKeys(env, undefined)).toBe(env);
	});

	it("returns the input unchanged when keysToStrip is empty", () => {
		// Identity (===) is intentional — the function avoids the cost of
		// building a Set + new object when there's nothing to filter.
		// Callers spread `stripKeys(env, undefined)` unconditionally;
		// pinning identity here means that costs nothing in the common case.
		const env = { A: "1", B: "2" };
		expect(stripKeys(env, [])).toBe(env);
	});
});

describe("stripKeys: removes named keys", () => {
	it("removes a single named key", () => {
		expect(
			stripKeys(
				{ GITHUB_TOKEN: "real_token", PATH: "/usr/bin", HOME: "/home/u" },
				["GITHUB_TOKEN"],
			),
		).toEqual({ PATH: "/usr/bin", HOME: "/home/u" });
	});

	it("removes multiple named keys", () => {
		expect(
			stripKeys(
				{
					GITHUB_TOKEN: "x",
					GH_TOKEN: "y",
					GH_ENTERPRISE_TOKEN: "z",
					KEEP_ME: "ok",
				},
				["GITHUB_TOKEN", "GH_TOKEN", "GH_ENTERPRISE_TOKEN"],
			),
		).toEqual({ KEEP_ME: "ok" });
	});

	it("ignores keys-to-strip that aren't present in env", () => {
		const env = { PATH: "/usr/bin" };
		expect(stripKeys(env, ["GITHUB_TOKEN", "DOES_NOT_EXIST"])).toEqual({
			PATH: "/usr/bin",
		});
	});

	it("preserves the input — does not mutate", () => {
		// Caller may keep a reference to the env for diagnostic logging.
		// Strip must produce a fresh object when filtering.
		const env = { GITHUB_TOKEN: "x", PATH: "/usr/bin" };
		const before = JSON.stringify(env);
		const result = stripKeys(env, ["GITHUB_TOKEN"]);
		expect(JSON.stringify(env)).toBe(before);
		// Result is a separate object.
		expect(result).not.toBe(env);
	});

	it("is case-sensitive (matches env-var conventions on Linux)", () => {
		// Linux env vars are case-sensitive. Pinning so a future "be helpful
		// and lowercase-match" change can't slip through and accidentally
		// strip more than the caller asked for.
		const env = { github_token: "lowercase-not-real", PATH: "/usr/bin" };
		expect(stripKeys(env, ["GITHUB_TOKEN"])).toEqual(env);
	});

	it("preserves prototype-pollution-style keys", () => {
		// Ensure stripKeys uses Object.entries (own properties only) — no
		// prototype walk that could leak inherited properties or get fooled
		// by a poisoned prototype.
		const env = { __proto__: "weird", PATH: "/usr/bin" };
		const out = stripKeys(env, ["GITHUB_TOKEN"]);
		expect(out.PATH).toBe("/usr/bin");
		// Don't enforce specific behavior for __proto__ — Object.entries
		// handles its own-property-ness correctly. The only invariant we
		// care about is that PATH survives.
	});
});
