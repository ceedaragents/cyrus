import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock os.homedir to use a temp directory
const TEST_HOME = join(tmpdir(), `cyrus-settings-test-${Date.now()}`);
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		homedir: () => TEST_HOME,
	};
});

// Import after mocking
import { ClaudeSettingsWriter } from "../src/ClaudeSettingsWriter.js";

describe("ClaudeSettingsWriter", () => {
	let writer: ClaudeSettingsWriter;

	beforeEach(() => {
		mkdirSync(join(TEST_HOME, ".claude"), { recursive: true });
		writer = new ClaudeSettingsWriter();
	});

	afterEach(() => {
		if (existsSync(TEST_HOME)) {
			rmSync(TEST_HOME, { recursive: true, force: true });
		}
	});

	describe("writeSandboxPorts", () => {
		it("creates settings.json if it does not exist", () => {
			// Remove settings.json if it was created by beforeEach
			const settingsPath = join(TEST_HOME, ".claude", "settings.json");
			if (existsSync(settingsPath)) {
				rmSync(settingsPath);
			}

			writer.writeSandboxPorts(9080, 9081);

			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			expect(settings.sandbox.network).toEqual({
				httpProxyPort: 9080,
				socksProxyPort: 9081,
			});
		});

		it("preserves existing settings", () => {
			const settingsPath = join(TEST_HOME, ".claude", "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					model: "opus",
					permissions: { allow: ["Read"] },
				}),
			);

			writer.writeSandboxPorts(8080, 8081);

			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			expect(settings.model).toBe("opus");
			expect(settings.permissions).toEqual({ allow: ["Read"] });
			expect(settings.sandbox.network).toEqual({
				httpProxyPort: 8080,
				socksProxyPort: 8081,
			});
		});

		it("preserves existing sandbox settings other than network", () => {
			const settingsPath = join(TEST_HOME, ".claude", "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					sandbox: {
						allowedDomains: ["example.com"],
						allowManagedDomainsOnly: true,
					},
				}),
			);

			writer.writeSandboxPorts(9080, 9081);

			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			expect(settings.sandbox.allowedDomains).toEqual(["example.com"]);
			expect(settings.sandbox.allowManagedDomainsOnly).toBe(true);
			expect(settings.sandbox.network).toEqual({
				httpProxyPort: 9080,
				socksProxyPort: 9081,
			});
		});

		it("overwrites existing network config", () => {
			const settingsPath = join(TEST_HOME, ".claude", "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					sandbox: {
						network: { httpProxyPort: 1111, socksProxyPort: 2222 },
					},
				}),
			);

			writer.writeSandboxPorts(9080, 9081);

			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			expect(settings.sandbox.network).toEqual({
				httpProxyPort: 9080,
				socksProxyPort: 9081,
			});
		});
	});

	describe("removeSandboxPorts", () => {
		it("removes network from sandbox config", () => {
			const settingsPath = join(TEST_HOME, ".claude", "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					model: "opus",
					sandbox: {
						allowedDomains: ["example.com"],
						network: { httpProxyPort: 9080, socksProxyPort: 9081 },
					},
				}),
			);

			writer.removeSandboxPorts();

			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			expect(settings.model).toBe("opus");
			expect(settings.sandbox.allowedDomains).toEqual(["example.com"]);
			expect(settings.sandbox.network).toBeUndefined();
		});

		it("removes sandbox key entirely if empty after removing network", () => {
			const settingsPath = join(TEST_HOME, ".claude", "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					model: "opus",
					sandbox: {
						network: { httpProxyPort: 9080, socksProxyPort: 9081 },
					},
				}),
			);

			writer.removeSandboxPorts();

			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			expect(settings.model).toBe("opus");
			expect(settings.sandbox).toBeUndefined();
		});

		it("handles missing settings.json gracefully", () => {
			// Should not throw
			writer.removeSandboxPorts();
		});
	});
});
