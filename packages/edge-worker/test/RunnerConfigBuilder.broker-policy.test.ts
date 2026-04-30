// Learning tests for buildGitHubBrokeredPolicy — the pure function that
// layers GitHub credential-brokering transforms onto a base NetworkPolicy.
//
// What we pin down:
//   1. Bearer for api.github.com (gh CLI shape).
//   2. Basic for github.com with x-access-token user (git over HTTPS shape),
//      base64 payload exactly canonical.
//   3. Composition with undefined / empty / preset / explicit base policies.
//   4. The composition produces a policy that EgressProxy.parsePolicy will
//      ingest correctly: brokered transform wins on Authorization conflict
//      because it is appended LAST (per the Object.assign-based merge order
//      already pinned in EgressProxy.transforms.test.ts).

import type { NetworkPolicy } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { buildGitHubBrokeredPolicy } from "../src/RunnerConfigBuilder.js";

const TOKEN = "ghs_real_installation_token_xyz";

function basicHeaderFor(token: string): string {
	return `Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;
}

describe("buildGitHubBrokeredPolicy: required transforms", () => {
	it("emits Bearer auth for api.github.com", () => {
		const policy = buildGitHubBrokeredPolicy(undefined, TOKEN);
		const apiRules = policy.allow?.["api.github.com"];
		expect(apiRules).toBeDefined();
		const transformHeaders = apiRules![0]!.transform![0]!.headers;
		expect(transformHeaders.Authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("emits Basic auth with x-access-token username for github.com", () => {
		// Why x-access-token: GitHub's canonical username for App-installation
		// tokens. PATs also accept it (or any non-empty username). Pinning the
		// exact username so a future refactor doesn't silently change semantics.
		const policy = buildGitHubBrokeredPolicy(undefined, TOKEN);
		const gitRules = policy.allow?.["github.com"];
		expect(gitRules).toBeDefined();
		const transformHeaders = gitRules![0]!.transform![0]!.headers;
		expect(transformHeaders.Authorization).toBe(basicHeaderFor(TOKEN));
	});

	it("Basic header decodes back to the canonical x-access-token:<token> string", () => {
		// Round-trip property: if a future change uses a different username
		// or encoding, this fails immediately.
		const policy = buildGitHubBrokeredPolicy(undefined, TOKEN);
		const auth =
			policy.allow!["github.com"]![0]!.transform![0]!.headers.Authorization;
		const b64 = auth.replace(/^Basic /, "");
		expect(Buffer.from(b64, "base64").toString("utf8")).toBe(
			`x-access-token:${TOKEN}`,
		);
	});

	it("rejects empty / missing tokens loudly (caller MUST check resolution)", () => {
		// Silent no-op on empty token would hide bugs where token resolution
		// failed but brokering proceeded anyway, leaving the policy in a
		// partially-applied state. The function throws so caller is forced
		// to check.
		expect(() => buildGitHubBrokeredPolicy(undefined, "")).toThrow();
	});
});

describe("buildGitHubBrokeredPolicy: composition with base policy", () => {
	it("undefined base → policy with only the two brokered domains", () => {
		const policy = buildGitHubBrokeredPolicy(undefined, TOKEN);
		expect(Object.keys(policy.allow ?? {})).toEqual([
			"api.github.com",
			"github.com",
		]);
	});

	it("preset:trusted base → preset preserved, brokered domains added", () => {
		// EgressProxy.parsePolicy expands preset:trusted into ~200 entries at
		// runtime. Our helper does NOT pre-expand the preset; it just preserves
		// the preset field. The proxy's existing { ...preset, ...explicit }
		// merge order means our explicit api.github.com / github.com entries
		// override the preset's empty rule for those same domains.
		const base: NetworkPolicy = { preset: "trusted" };
		const policy = buildGitHubBrokeredPolicy(base, TOKEN);
		expect(policy.preset).toBe("trusted");
		expect(policy.allow?.["api.github.com"]).toBeDefined();
		expect(policy.allow?.["github.com"]).toBeDefined();
	});

	it("base with unrelated allowed domains → those preserved unchanged", () => {
		const base: NetworkPolicy = {
			allow: {
				"registry.npmjs.org": [{}],
				"private.example.com": [
					{ transform: [{ headers: { "x-internal": "k" } }] },
				],
			},
		};
		const policy = buildGitHubBrokeredPolicy(base, TOKEN);
		expect(policy.allow?.["registry.npmjs.org"]).toEqual([{}]);
		expect(
			policy.allow?.["private.example.com"]![0]!.transform![0]!.headers,
		).toEqual({ "x-internal": "k" });
		// Brokered domains added alongside.
		expect(policy.allow?.["api.github.com"]).toBeDefined();
		expect(policy.allow?.["github.com"]).toBeDefined();
	});

	it("base with user transforms on api.github.com → brokered rule appended last (wins on Authorization conflict)", () => {
		// Per EgressProxy.parsePolicy, all rules' headers are merged via
		// Object.assign — later rules win on key conflict. We append the
		// brokered rule after any existing user rules so the broker is
		// authoritative for Authorization.
		const base: NetworkPolicy = {
			allow: {
				"api.github.com": [
					{
						transform: [
							{
								headers: {
									Authorization: "Bearer user-supplied-token",
									"X-User-Header": "kept",
								},
							},
						],
					},
				],
			},
		};
		const policy = buildGitHubBrokeredPolicy(base, TOKEN);
		const rules = policy.allow!["api.github.com"]!;
		// Both rules present, brokered rule LAST.
		expect(rules).toHaveLength(2);
		expect(rules[0]!.transform![0]!.headers.Authorization).toBe(
			"Bearer user-supplied-token",
		);
		expect(rules[0]!.transform![0]!.headers["X-User-Header"]).toBe("kept");
		expect(rules[1]!.transform![0]!.headers.Authorization).toBe(
			`Bearer ${TOKEN}`,
		);
		// Note: when EgressProxy.parsePolicy ingests this, the merged
		// `domainTransforms` for api.github.com will contain BOTH
		// X-User-Header and the BROKERED Authorization (later wins).
	});

	it("does not mutate the input base policy", () => {
		// Caller may keep a reference to the base policy for diff/log purposes.
		// We must produce a fresh object.
		const base: NetworkPolicy = {
			allow: {
				"registry.npmjs.org": [{}],
			},
		};
		const before = JSON.stringify(base);
		buildGitHubBrokeredPolicy(base, TOKEN);
		expect(JSON.stringify(base)).toBe(before);
	});
});
