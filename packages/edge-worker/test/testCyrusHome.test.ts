import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestCyrusHome } from "./testCyrusHome.js";

describe("createTestCyrusHome", () => {
	it("creates an isolated writable temp home", () => {
		const first = createTestCyrusHome();
		const second = createTestCyrusHome();

		expect(first).not.toBe(second);
		expect(existsSync(first)).toBe(true);
		expect(existsSync(second)).toBe(true);

		const sentinelPath = join(first, "logs", "default", "pending.log");
		writeFileSync(sentinelPath, "writable");
		expect(existsSync(sentinelPath)).toBe(true);
	});
});
