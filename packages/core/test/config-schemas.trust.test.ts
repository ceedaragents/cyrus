import { describe, expect, it } from "vitest";
import {
	EdgeConfigSchema,
	McpAccessSchema,
	SessionSourceTrustSchema,
	TrustLevelSchema,
} from "../src/config-schemas.js";

describe("TrustLevelSchema", () => {
	it("accepts 'trusted'", () => {
		expect(TrustLevelSchema.parse("trusted")).toBe("trusted");
	});

	it("accepts 'untrusted'", () => {
		expect(TrustLevelSchema.parse("untrusted")).toBe("untrusted");
	});

	it("rejects invalid values", () => {
		expect(() => TrustLevelSchema.parse("semi-trusted")).toThrow();
		expect(() => TrustLevelSchema.parse("")).toThrow();
		expect(() => TrustLevelSchema.parse(42)).toThrow();
	});
});

describe("SessionSourceTrustSchema", () => {
	it("accepts well-known sources with trust levels", () => {
		const config = {
			linear: "trusted",
			github: "untrusted",
			slack: "untrusted",
		};
		expect(SessionSourceTrustSchema.parse(config)).toEqual(config);
	});

	it("accepts future/unknown source names", () => {
		const config = {
			linear: "trusted",
			discord: "untrusted",
			teams: "trusted",
		};
		expect(SessionSourceTrustSchema.parse(config)).toEqual(config);
	});

	it("accepts empty object", () => {
		expect(SessionSourceTrustSchema.parse({})).toEqual({});
	});

	it("rejects invalid trust levels", () => {
		expect(() => SessionSourceTrustSchema.parse({ linear: "maybe" })).toThrow();
	});
});

describe("McpAccessSchema", () => {
	it("accepts trusted and untrusted server slug arrays", () => {
		const config = {
			trusted: ["server-a", "server-b"],
			untrusted: ["server-a"],
		};
		expect(McpAccessSchema.parse(config)).toEqual(config);
	});

	it("accepts empty arrays", () => {
		const config = {
			trusted: [],
			untrusted: [],
		};
		expect(McpAccessSchema.parse(config)).toEqual(config);
	});

	it("accepts partial config (only trusted)", () => {
		const config = { trusted: ["server-a"] };
		expect(McpAccessSchema.parse(config)).toEqual(config);
	});

	it("accepts partial config (only untrusted)", () => {
		const config = { untrusted: ["server-a"] };
		expect(McpAccessSchema.parse(config)).toEqual(config);
	});

	it("accepts empty object", () => {
		expect(McpAccessSchema.parse({})).toEqual({});
	});
});

describe("EdgeConfigSchema with trust fields", () => {
	const minimalEdgeConfig = {
		repositories: [],
	};

	it("accepts config without trust fields (backward compatible)", () => {
		const result = EdgeConfigSchema.parse(minimalEdgeConfig);
		expect(result.sessionSourceTrust).toBeUndefined();
		expect(result.mcpAccess).toBeUndefined();
	});

	it("accepts config with sessionSourceTrust", () => {
		const config = {
			...minimalEdgeConfig,
			sessionSourceTrust: {
				linear: "trusted",
				github: "untrusted",
				slack: "untrusted",
			},
		};
		const result = EdgeConfigSchema.parse(config);
		expect(result.sessionSourceTrust).toEqual({
			linear: "trusted",
			github: "untrusted",
			slack: "untrusted",
		});
	});

	it("accepts config with mcpAccess", () => {
		const config = {
			...minimalEdgeConfig,
			mcpAccess: {
				trusted: ["linear-mcp", "custom-db"],
				untrusted: ["linear-mcp"],
			},
		};
		const result = EdgeConfigSchema.parse(config);
		expect(result.mcpAccess).toEqual({
			trusted: ["linear-mcp", "custom-db"],
			untrusted: ["linear-mcp"],
		});
	});

	it("accepts config with both trust fields", () => {
		const config = {
			...minimalEdgeConfig,
			sessionSourceTrust: {
				linear: "trusted",
				github: "untrusted",
			},
			mcpAccess: {
				trusted: ["server-a", "server-b"],
				untrusted: [],
			},
		};
		const result = EdgeConfigSchema.parse(config);
		expect(result.sessionSourceTrust).toEqual({
			linear: "trusted",
			github: "untrusted",
		});
		expect(result.mcpAccess).toEqual({
			trusted: ["server-a", "server-b"],
			untrusted: [],
		});
	});
});
