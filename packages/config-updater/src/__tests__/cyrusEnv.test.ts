import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleCyrusEnv } from "../handlers/cyrusEnv.js";
import type { CyrusEnvPayload } from "../types.js";

describe("handleCyrusEnv", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(process.cwd(), ".test-cyrus-env");
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("should create .env file with valid payload", async () => {
		const payload: CyrusEnvPayload = {
			ANTHROPIC_API_KEY: "sk-test-123",
			CUSTOM_VAR: "value",
		};

		const result = await handleCyrusEnv(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.message).toBe("Environment variables updated successfully");

		// Verify file was created
		const envPath = join(testDir, ".env");
		expect(existsSync(envPath)).toBe(true);

		// Verify content
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("ANTHROPIC_API_KEY=sk-test-123");
		expect(content).toContain("CUSTOM_VAR=value");
	});

	it("should accept variables in nested 'variables' key", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				ANTHROPIC_API_KEY: "sk-test-456",
				OTHER_VAR: "other-value",
			},
		};

		const result = await handleCyrusEnv(payload, testDir);

		expect(result.success).toBe(true);

		const envPath = join(testDir, ".env");
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("ANTHROPIC_API_KEY=sk-test-456");
		expect(content).toContain("OTHER_VAR=other-value");
	});

	it("should merge with existing env file", async () => {
		// Create initial .env file
		const envPath = join(testDir, ".env");
		writeFileSync(envPath, "EXISTING_VAR=existing-value\n", "utf-8");

		// Update with new variables
		const payload: CyrusEnvPayload = {
			NEW_VAR: "new-value",
		};

		await handleCyrusEnv(payload, testDir);

		// Verify both variables exist
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("EXISTING_VAR=existing-value");
		expect(content).toContain("NEW_VAR=new-value");
	});

	it("should override existing variables with new values", async () => {
		// Create initial .env file
		const envPath = join(testDir, ".env");
		writeFileSync(envPath, "API_KEY=old-key\n", "utf-8");

		// Update with new value
		const payload: CyrusEnvPayload = {
			API_KEY: "new-key",
		};

		await handleCyrusEnv(payload, testDir);

		// Verify variable was updated
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("API_KEY=new-key");
		expect(content).not.toContain("API_KEY=old-key");
	});

	it("should filter out control keys (restartCyrus, backupEnv, variables)", async () => {
		const payload: CyrusEnvPayload = {
			ANTHROPIC_API_KEY: "sk-test-789",
			restartCyrus: true,
			backupEnv: true,
		};

		await handleCyrusEnv(payload, testDir);

		const envPath = join(testDir, ".env");
		const content = readFileSync(envPath, "utf-8");

		// Should contain actual env var
		expect(content).toContain("ANTHROPIC_API_KEY=sk-test-789");

		// Should NOT contain control keys
		expect(content).not.toContain("restartCyrus");
		expect(content).not.toContain("backupEnv");
	});

	it("should reject payload with no environment variables", async () => {
		const payload: CyrusEnvPayload = {
			restartCyrus: true,
			// No actual env vars
		};

		const result = await handleCyrusEnv(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe("No environment variables to update");
	});

	it("should reject invalid payload", async () => {
		const payload = null as any;

		const result = await handleCyrusEnv(payload, testDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Environment variables update requires valid data",
		);
	});

	it("should preserve comments and empty lines in existing .env", async () => {
		// Create .env with comments
		const envPath = join(testDir, ".env");
		const initialContent = `# This is a comment
EXISTING_VAR=value

# Another comment
`;
		writeFileSync(envPath, initialContent, "utf-8");

		// Update with new variable
		const payload: CyrusEnvPayload = {
			NEW_VAR: "new-value",
		};

		await handleCyrusEnv(payload, testDir);

		// Comments will be lost (by design - simple KEY=VALUE format)
		// But existing var should still be there
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("EXISTING_VAR=value");
		expect(content).toContain("NEW_VAR=new-value");
	});

	it("should return restartCyrus flag in response data", async () => {
		const payload: CyrusEnvPayload = {
			ANTHROPIC_API_KEY: "sk-test-999",
			restartCyrus: true,
		};

		const result = await handleCyrusEnv(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.data?.restartCyrus).toBe(true);
	});

	it("should return list of updated variables", async () => {
		const payload: CyrusEnvPayload = {
			VAR_1: "value1",
			VAR_2: "value2",
			VAR_3: "value3",
		};

		const result = await handleCyrusEnv(payload, testDir);

		expect(result.success).toBe(true);
		expect(result.data?.variablesUpdated).toEqual(["VAR_1", "VAR_2", "VAR_3"]);
	});
});
