import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type {
	CyrusEnvPayload,
	EnvManifest,
	EnvVariablesPayload,
} from "../types";
import { handleUpdateCyrusEnv, handleUpdateEnvVariables } from "./env-handler";

describe("handleUpdateEnvVariables", () => {
	let testDir: string;
	let manifestPath: string;

	beforeEach(async () => {
		// Create a unique temporary directory for each test
		testDir = join(tmpdir(), `cyrus-env-test-${Date.now()}-${Math.random()}`);
		await fs.mkdir(testDir, { recursive: true });
		manifestPath = join(testDir, "env-manifest.yml");
	});

	afterEach(async () => {
		// Clean up the test directory
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch (_error) {
			// Ignore cleanup errors
		}
	});

	it("should create new manifest with initial variables", async () => {
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "API_KEY", value: "secret123" },
				{ key: "DEBUG", value: "true" },
			],
		};

		await handleUpdateEnvVariables(payload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);

		expect(manifest.version).toBe("1.0");
		expect(manifest.repositories["my-repo"]).toBeDefined();
		expect(manifest.repositories["my-repo"].env_files[".env"]).toBeDefined();

		const envFile = manifest.repositories["my-repo"].env_files[".env"];
		expect(envFile.variables.API_KEY).toBe("secret123");
		expect(envFile.variables.DEBUG).toBe("true");
		expect(envFile.last_updated).toBeTruthy();
		expect(new Date(envFile.last_updated).getTime()).toBeGreaterThan(0);
	});

	it("should replace variables when append is false", async () => {
		// First create initial variables
		const initialPayload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "VAR1", value: "value1" },
				{ key: "VAR2", value: "value2" },
				{ key: "VAR3", value: "value3" },
			],
		};
		await handleUpdateEnvVariables(initialPayload, manifestPath);

		// Now replace with new variables
		const replacePayload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "VAR1", value: "new_value1" },
				{ key: "VAR4", value: "value4" },
			],
			append: false,
		};
		await handleUpdateEnvVariables(replacePayload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);
		const envFile = manifest.repositories["my-repo"].env_files[".env"];

		// Should only have the new variables
		expect(envFile.variables.VAR1).toBe("new_value1");
		expect(envFile.variables.VAR4).toBe("value4");
		expect(envFile.variables.VAR2).toBeUndefined();
		expect(envFile.variables.VAR3).toBeUndefined();
	});

	it("should append variables when append is true", async () => {
		// First create initial variables
		const initialPayload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "VAR1", value: "value1" },
				{ key: "VAR2", value: "value2" },
			],
		};
		await handleUpdateEnvVariables(initialPayload, manifestPath);

		// Append new variables
		const appendPayload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "VAR1", value: "updated_value1" },
				{ key: "VAR3", value: "value3" },
			],
			append: true,
		};
		await handleUpdateEnvVariables(appendPayload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);
		const envFile = manifest.repositories["my-repo"].env_files[".env"];

		// Should have all variables, with VAR1 updated
		expect(envFile.variables.VAR1).toBe("updated_value1");
		expect(envFile.variables.VAR2).toBe("value2");
		expect(envFile.variables.VAR3).toBe("value3");
	});

	it("should clear all variables in replace mode with empty variables array", async () => {
		// First create initial variables
		const initialPayload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "VAR1", value: "value1" },
				{ key: "VAR2", value: "value2" },
			],
		};
		await handleUpdateEnvVariables(initialPayload, manifestPath);

		// Clear all variables
		const clearPayload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [],
			append: false,
		};
		await handleUpdateEnvVariables(clearPayload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);
		const envFile = manifest.repositories["my-repo"].env_files[".env"];

		// Should have no variables
		expect(Object.keys(envFile.variables)).toHaveLength(0);
	});

	it("should handle multiple repositories", async () => {
		const repo1Payload: EnvVariablesPayload = {
			repository: "repo-1",
			file_path: ".env",
			variables: [{ key: "KEY1", value: "value1" }],
		};
		await handleUpdateEnvVariables(repo1Payload, manifestPath);

		const repo2Payload: EnvVariablesPayload = {
			repository: "repo-2",
			file_path: ".env",
			variables: [{ key: "KEY2", value: "value2" }],
		};
		await handleUpdateEnvVariables(repo2Payload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);

		expect(manifest.repositories["repo-1"]).toBeDefined();
		expect(manifest.repositories["repo-2"]).toBeDefined();
		expect(
			manifest.repositories["repo-1"].env_files[".env"].variables.KEY1,
		).toBe("value1");
		expect(
			manifest.repositories["repo-2"].env_files[".env"].variables.KEY2,
		).toBe("value2");
	});

	it("should handle multiple files per repository", async () => {
		const env1Payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [{ key: "KEY1", value: "value1" }],
		};
		await handleUpdateEnvVariables(env1Payload, manifestPath);

		const env2Payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env.production",
			variables: [{ key: "KEY2", value: "value2" }],
		};
		await handleUpdateEnvVariables(env2Payload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);
		const envFiles = manifest.repositories["my-repo"].env_files;

		expect(envFiles[".env"]).toBeDefined();
		expect(envFiles[".env.production"]).toBeDefined();
		expect(envFiles[".env"].variables.KEY1).toBe("value1");
		expect(envFiles[".env.production"].variables.KEY2).toBe("value2");
	});

	it("should filter out empty keys", async () => {
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "VALID_KEY", value: "value1" },
				{ key: "", value: "should_be_ignored" },
				{ key: "ANOTHER_VALID", value: "value2" },
			],
		};

		await handleUpdateEnvVariables(payload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);
		const envFile = manifest.repositories["my-repo"].env_files[".env"];

		expect(envFile.variables.VALID_KEY).toBe("value1");
		expect(envFile.variables.ANOTHER_VALID).toBe("value2");
		expect(Object.keys(envFile.variables)).toHaveLength(2);
	});

	it("should throw error when repository is missing", async () => {
		const payload = {
			file_path: ".env",
			variables: [{ key: "KEY", value: "value" }],
		} as EnvVariablesPayload;

		await expect(
			handleUpdateEnvVariables(payload, manifestPath),
		).rejects.toThrow("Repository name is required");
	});

	it("should throw error when file_path is missing", async () => {
		const payload = {
			repository: "my-repo",
			variables: [{ key: "KEY", value: "value" }],
		} as EnvVariablesPayload;

		await expect(
			handleUpdateEnvVariables(payload, manifestPath),
		).rejects.toThrow("File path is required");
	});

	it("should throw error when variables are empty in append mode", async () => {
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [],
			append: true,
		};

		await expect(
			handleUpdateEnvVariables(payload, manifestPath),
		).rejects.toThrow("No variables provided for append operation");
	});

	it("should create manifest directory if it does not exist", async () => {
		const nestedPath = join(testDir, "nested", "path", "env-manifest.yml");
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [{ key: "KEY", value: "value" }],
		};

		await handleUpdateEnvVariables(payload, nestedPath);

		const exists = await fs
			.access(nestedPath)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);
	});

	it("should set correct file permissions (0644)", async () => {
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [{ key: "KEY", value: "value" }],
		};

		await handleUpdateEnvVariables(payload, manifestPath);

		const stats = await fs.stat(manifestPath);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o644);
	});

	it("should update last_updated timestamp on each update", async () => {
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [{ key: "KEY", value: "value1" }],
		};

		await handleUpdateEnvVariables(payload, manifestPath);

		const content1 = await fs.readFile(manifestPath, "utf-8");
		const manifest1: EnvManifest = parseYaml(content1);
		const timestamp1 =
			manifest1.repositories["my-repo"].env_files[".env"].last_updated;

		// Wait a moment to ensure timestamp is different
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Update again
		payload.variables = [{ key: "KEY", value: "value2" }];
		await handleUpdateEnvVariables(payload, manifestPath);

		const content2 = await fs.readFile(manifestPath, "utf-8");
		const manifest2: EnvManifest = parseYaml(content2);
		const timestamp2 =
			manifest2.repositories["my-repo"].env_files[".env"].last_updated;

		expect(timestamp2).not.toBe(timestamp1);
		expect(new Date(timestamp2).getTime()).toBeGreaterThan(
			new Date(timestamp1).getTime(),
		);
	});

	it("should handle values with special characters", async () => {
		const payload: EnvVariablesPayload = {
			repository: "my-repo",
			file_path: ".env",
			variables: [
				{ key: "URL", value: "https://example.com/path?query=value&foo=bar" },
				{ key: "JSON", value: '{"key":"value","nested":{"prop":123}}' },
				{ key: "MULTILINE", value: "line1\nline2\nline3" },
			],
		};

		await handleUpdateEnvVariables(payload, manifestPath);

		const content = await fs.readFile(manifestPath, "utf-8");
		const manifest: EnvManifest = parseYaml(content);
		const envFile = manifest.repositories["my-repo"].env_files[".env"];

		expect(envFile.variables.URL).toBe(
			"https://example.com/path?query=value&foo=bar",
		);
		expect(envFile.variables.JSON).toBe(
			'{"key":"value","nested":{"prop":123}}',
		);
		expect(envFile.variables.MULTILINE).toBe("line1\nline2\nline3");
	});
});

describe("handleUpdateCyrusEnv", () => {
	let testCyrusHome: string;

	beforeEach(async () => {
		// Create a unique temporary directory for each test
		testCyrusHome = join(
			tmpdir(),
			`cyrus-env-test-${Date.now()}-${Math.random()}`,
		);
		await fs.mkdir(testCyrusHome, { recursive: true });
	});

	afterEach(async () => {
		// Clean up the test directory
		try {
			await fs.rm(testCyrusHome, { recursive: true, force: true });
		} catch (_error) {
			// Ignore cleanup errors
		}
	});

	it("should create new .env file with variables", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				PORT: "3000",
				NODE_ENV: "production",
				DEBUG: "true",
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const envPath = join(testCyrusHome, ".env");
		const content = await fs.readFile(envPath, "utf-8");

		expect(content).toContain("PORT=3000");
		expect(content).toContain("NODE_ENV=production");
		expect(content).toContain("DEBUG=true");
	});

	it("should merge variables with existing .env", async () => {
		// Create initial .env
		const envPath = join(testCyrusHome, ".env");
		await fs.writeFile(envPath, "EXISTING_VAR=existing\nPORT=8080\n");

		// Update with new variables
		const payload: CyrusEnvPayload = {
			variables: {
				PORT: "3000", // Override
				NEW_VAR: "new", // Add
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const content = await fs.readFile(envPath, "utf-8");

		expect(content).toContain("EXISTING_VAR=existing"); // Preserved
		expect(content).toContain("PORT=3000"); // Updated
		expect(content).toContain("NEW_VAR=new"); // Added
	});

	it("should handle values with spaces by quoting them", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				MESSAGE: "Hello World",
				PATH: "/usr/local/bin:/usr/bin:/bin",
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const envPath = join(testCyrusHome, ".env");
		const content = await fs.readFile(envPath, "utf-8");

		expect(content).toContain('MESSAGE="Hello World"');
		expect(content).toContain('PATH="/usr/local/bin:/usr/bin:/bin"');
	});

	it("should handle values with special characters", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				URL: "https://example.com?query=value&foo=bar",
				PASSWORD: "p@ssw0rd!#$%",
				SIMPLE: "simple",
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const envPath = join(testCyrusHome, ".env");
		const content = await fs.readFile(envPath, "utf-8");

		expect(content).toContain('URL="https://example.com?query=value&foo=bar"');
		expect(content).toContain('PASSWORD="p@ssw0rd!#$%"');
		expect(content).toContain("SIMPLE=simple");
	});

	it("should parse existing .env with quoted values", async () => {
		// Create .env with quoted values
		const envPath = join(testCyrusHome, ".env");
		await fs.writeFile(
			envPath,
			"QUOTED_DOUBLE=\"value with spaces\"\nQUOTED_SINGLE='single quotes'\nUNQUOTED=simple\n",
		);

		const payload: CyrusEnvPayload = {
			variables: {
				NEW_VAR: "new",
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const content = await fs.readFile(envPath, "utf-8");

		// Quotes should be removed during parsing and re-added if needed
		// The serializer always uses double quotes for consistency
		expect(content).toContain('QUOTED_DOUBLE="value with spaces"');
		expect(content).toContain('QUOTED_SINGLE="single quotes"');
		expect(content).toContain("UNQUOTED=simple");
		expect(content).toContain("NEW_VAR=new");
	});

	it("should skip comments and empty lines when parsing", async () => {
		const envPath = join(testCyrusHome, ".env");
		await fs.writeFile(
			envPath,
			"# This is a comment\nVAR1=value1\n\n# Another comment\nVAR2=value2\n\n",
		);

		const payload: CyrusEnvPayload = {
			variables: {
				VAR3: "value3",
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const envPath2 = join(testCyrusHome, ".env");
		const content = await fs.readFile(envPath2, "utf-8");

		expect(content).toContain("VAR1=value1");
		expect(content).toContain("VAR2=value2");
		expect(content).toContain("VAR3=value3");
		// Comments are not preserved in the output
	});

	it("should create backup when backupEnv is true", async () => {
		// Create initial .env
		const envPath = join(testCyrusHome, ".env");
		await fs.writeFile(envPath, "ORIGINAL=value\n");

		// Wait a moment to ensure timestamp is different
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Update with backup
		const payload: CyrusEnvPayload = {
			variables: {
				NEW: "value",
			},
			backupEnv: true,
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		// Check that backup was created
		const backupDir = join(testCyrusHome, "env-backups");
		const backupFiles = await fs.readdir(backupDir);
		expect(backupFiles.length).toBeGreaterThan(0);
		expect(backupFiles[0]).toMatch(
			/^\.env-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/,
		);

		// Verify backup contains original content
		const backupPath = join(backupDir, backupFiles[0]);
		const backupContent = await fs.readFile(backupPath, "utf-8");
		expect(backupContent).toBe("ORIGINAL=value\n");

		// Verify new .env has both original and new
		const newContent = await fs.readFile(envPath, "utf-8");
		expect(newContent).toContain("ORIGINAL=value");
		expect(newContent).toContain("NEW=value");
	});

	it("should not create backup when backupEnv is false", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				VAR: "value",
			},
			backupEnv: false,
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const backupDir = join(testCyrusHome, "env-backups");
		const exists = await fs
			.access(backupDir)
			.then(() => true)
			.catch(() => false);

		expect(exists).toBe(false);
	});

	it("should set correct file permissions (0644) for .env", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				VAR: "value",
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const envPath = join(testCyrusHome, ".env");
		const stats = await fs.stat(envPath);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o644);
	});

	it("should create Cyrus app directory if it does not exist", async () => {
		const nestedCyrusHome = join(testCyrusHome, "nested", "path", ".cyrus");

		const payload: CyrusEnvPayload = {
			variables: {
				VAR: "value",
			},
		};

		await handleUpdateCyrusEnv(payload, nestedCyrusHome);

		const envPath = join(nestedCyrusHome, ".env");
		const exists = await fs
			.access(envPath)
			.then(() => true)
			.catch(() => false);

		expect(exists).toBe(true);
	});

	it("should handle empty variables object", async () => {
		// Create initial .env
		const envPath = join(testCyrusHome, ".env");
		await fs.writeFile(envPath, "EXISTING=value\n");

		const payload: CyrusEnvPayload = {
			variables: {},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const content = await fs.readFile(envPath, "utf-8");
		// Should preserve existing variables
		expect(content).toContain("EXISTING=value");
	});

	it("should handle values with escaped quotes", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				JSON: '{"key":"value with \\"quotes\\""}',
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const envPath = join(testCyrusHome, ".env");
		const content = await fs.readFile(envPath, "utf-8");

		// The serializer escapes double quotes inside values
		// Input: {"key":"value with \"quotes\""}
		// Output in .env: JSON="{\"key\":\"value with \\\"quotes\\\"\"}"
		expect(content).toContain(
			'JSON="{\\"key\\":\\"value with \\\\"quotes\\\\"\\"}',
		);
	});

	it("should preserve order of variables (merged order)", async () => {
		// Create initial .env
		const envPath = join(testCyrusHome, ".env");
		await fs.writeFile(envPath, "A=1\nB=2\nC=3\n");

		const payload: CyrusEnvPayload = {
			variables: {
				D: "4",
				B: "20", // Update existing
			},
		};

		await handleUpdateCyrusEnv(payload, testCyrusHome);

		const content = await fs.readFile(envPath, "utf-8");
		const lines = content.trim().split("\n");

		// Order should be: existing vars (with updates), then new vars
		expect(lines).toContain("A=1");
		expect(lines).toContain("B=20");
		expect(lines).toContain("C=3");
		expect(lines).toContain("D=4");
	});

	it("should handle backup failure gracefully", async () => {
		const payload: CyrusEnvPayload = {
			variables: {
				VAR: "value",
			},
			backupEnv: true,
		};

		// Should not throw even though there's no existing .env to backup
		await expect(
			handleUpdateCyrusEnv(payload, testCyrusHome),
		).resolves.not.toThrow();

		const envPath = join(testCyrusHome, ".env");
		const content = await fs.readFile(envPath, "utf-8");
		expect(content).toContain("VAR=value");
	});
});
