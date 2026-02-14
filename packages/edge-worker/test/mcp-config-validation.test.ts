import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	formatValidationErrorsForLinear,
	loadAndValidateMcpConfigFile,
	loadAndValidateMcpConfigs,
	validateMcpConfig,
	validateMcpServerConfig,
} from "../src/mcp-validation/index.js";

describe("MCP Config Validation", () => {
	describe("validateMcpServerConfig", () => {
		describe("valid HTTP server configs", () => {
			it("should accept valid HTTP config with type", () => {
				const result = validateMcpServerConfig("sentry", {
					type: "http",
					url: "https://mcp.sentry.dev/mcp",
				});

				expect(result.isValid).toBe(true);
				expect(result.inferredType).toBe("http");
				expect(result.error).toBeUndefined();
			});

			it("should accept HTTP config with headers", () => {
				const result = validateMcpServerConfig("linear", {
					type: "http",
					url: "https://mcp.linear.app/mcp",
					headers: {
						Authorization: "Bearer token123",
					},
				});

				expect(result.isValid).toBe(true);
				expect(result.inferredType).toBe("http");
			});
		});

		describe("valid SSE server configs", () => {
			it("should accept valid SSE config with type", () => {
				const result = validateMcpServerConfig("streaming-server", {
					type: "sse",
					url: "https://example.com/sse",
				});

				expect(result.isValid).toBe(true);
				expect(result.inferredType).toBe("sse");
			});
		});

		describe("valid stdio server configs", () => {
			it("should accept stdio config with command only", () => {
				const result = validateMcpServerConfig("local-server", {
					command: "node",
					args: ["./mcp-server.js"],
				});

				expect(result.isValid).toBe(true);
				expect(result.inferredType).toBe("stdio");
			});

			it("should accept stdio config with explicit type", () => {
				const result = validateMcpServerConfig("local-server", {
					type: "stdio",
					command: "npx",
					args: ["mcp-server"],
					env: { DEBUG: "true" },
				});

				expect(result.isValid).toBe(true);
				expect(result.inferredType).toBe("stdio");
			});
		});

		describe("valid SDK server configs", () => {
			it("should accept SDK config without instance", () => {
				const result = validateMcpServerConfig("sdk-server", {
					type: "sdk",
					name: "my-sdk-server",
				});

				expect(result.isValid).toBe(true);
				expect(result.inferredType).toBe("sdk");
			});
		});

		describe("invalid configs - missing type for URL-based servers", () => {
			it("should reject URL-based config without type (issue root cause)", () => {
				// This is the exact scenario from CYPACK-708
				const result = validateMcpServerConfig("sentry", {
					url: "https://mcp.sentry.dev/mcp",
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("type");
				expect(result.error).toContain("http");
				expect(result.error).toContain("sse");
			});
		});

		describe("invalid configs - wrong type for URL-based servers", () => {
			it("should reject URL-based config with stdio type", () => {
				const result = validateMcpServerConfig("confused-server", {
					type: "stdio",
					url: "https://example.com/mcp",
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("invalid type");
			});
		});

		describe("invalid configs - malformed inputs", () => {
			it("should reject non-object configs", () => {
				const result = validateMcpServerConfig("bad-server", "not-an-object");

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("object");
			});

			it("should reject null configs", () => {
				const result = validateMcpServerConfig("null-server", null);

				expect(result.isValid).toBe(false);
			});

			it("should reject empty objects", () => {
				const result = validateMcpServerConfig("empty-server", {});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("command");
				expect(result.error).toContain("url");
			});

			it("should reject invalid URL format", () => {
				const result = validateMcpServerConfig("bad-url", {
					type: "http",
					url: "not-a-valid-url",
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("Invalid URL");
			});

			it("should reject empty command", () => {
				const result = validateMcpServerConfig("empty-cmd", {
					command: "",
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("empty");
			});

			it("should reject non-string args", () => {
				const result = validateMcpServerConfig("bad-args", {
					command: "node",
					args: [123, "valid"],
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("args");
			});

			it("should reject non-string header values", () => {
				const result = validateMcpServerConfig("bad-headers", {
					type: "http",
					url: "https://example.com",
					headers: {
						Authorization: 12345, // should be string
					},
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("Header");
			});

			it("should reject non-string env values", () => {
				const result = validateMcpServerConfig("bad-env", {
					command: "node",
					env: {
						PORT: 3000, // should be string
					},
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("env");
			});
		});

		describe("invalid SDK configs", () => {
			it("should reject SDK config with instance (not serializable)", () => {
				const result = validateMcpServerConfig("sdk-with-instance", {
					type: "sdk",
					name: "test",
					instance: {}, // Real instance would be an McpServer object
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("serialized");
				expect(result.error).toContain("createSdkMcpServer");
			});

			it("should reject SDK config without name", () => {
				const result = validateMcpServerConfig("sdk-no-name", {
					type: "sdk",
				});

				expect(result.isValid).toBe(false);
				expect(result.error).toContain("name");
			});
		});
	});

	describe("validateMcpConfig", () => {
		it("should validate multiple servers and separate valid from invalid", () => {
			const mcpServers = {
				"valid-http": {
					type: "http",
					url: "https://example.com/mcp",
				},
				"valid-stdio": {
					command: "node",
					args: ["server.js"],
				},
				"invalid-missing-type": {
					url: "https://mcp.sentry.dev/mcp", // Missing type
				},
				"invalid-bad-url": {
					type: "http",
					url: "not-a-url",
				},
			};

			const result = validateMcpConfig(mcpServers);

			expect(result.isValid).toBe(false);
			expect(Object.keys(result.validServers)).toHaveLength(2);
			expect(result.validServers["valid-http"]).toBeDefined();
			expect(result.validServers["valid-stdio"]).toBeDefined();
			expect(result.invalidServers).toHaveLength(2);
			expect(result.invalidServers.map((s) => s.serverName)).toContain(
				"invalid-missing-type",
			);
			expect(result.invalidServers.map((s) => s.serverName)).toContain(
				"invalid-bad-url",
			);
		});

		it("should return isValid true when all servers are valid", () => {
			const mcpServers = {
				server1: { type: "http", url: "https://example.com" },
				server2: { command: "node", args: ["test.js"] },
			};

			const result = validateMcpConfig(mcpServers);

			expect(result.isValid).toBe(true);
			expect(result.invalidServers).toHaveLength(0);
		});

		it("should handle empty config", () => {
			const result = validateMcpConfig({});

			expect(result.isValid).toBe(true);
			expect(Object.keys(result.validServers)).toHaveLength(0);
			expect(result.invalidServers).toHaveLength(0);
		});
	});

	describe("loadAndValidateMcpConfigFile", () => {
		const testDir = join(process.cwd(), "test-tmp-mcp-config");

		beforeEach(() => {
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("should load and validate a valid .mcp.json file", () => {
			const configPath = join(testDir, ".mcp.json");
			writeFileSync(
				configPath,
				JSON.stringify({
					mcpServers: {
						"test-server": {
							type: "http",
							url: "https://example.com/mcp",
						},
					},
				}),
			);

			const result = loadAndValidateMcpConfigFile(configPath);

			expect(result.success).toBe(true);
			expect(result.validationResult?.isValid).toBe(true);
			expect(result.config?.mcpServers["test-server"]).toBeDefined();
		});

		it("should handle file not found", () => {
			const result = loadAndValidateMcpConfigFile(
				"/nonexistent/path/.mcp.json",
			);

			expect(result.success).toBe(false);
			expect(result.parseError).toContain("not found");
		});

		it("should handle invalid JSON", () => {
			const configPath = join(testDir, "invalid.json");
			writeFileSync(configPath, "{ not valid json }");

			const result = loadAndValidateMcpConfigFile(configPath);

			expect(result.success).toBe(false);
			expect(result.parseError).toContain("Invalid JSON");
		});

		it("should handle missing mcpServers field", () => {
			const configPath = join(testDir, "empty.json");
			writeFileSync(configPath, JSON.stringify({ otherField: "value" }));

			const result = loadAndValidateMcpConfigFile(configPath);

			expect(result.success).toBe(true);
			expect(result.config?.mcpServers).toEqual({});
		});

		it("should filter out invalid servers from config", () => {
			const configPath = join(testDir, "mixed.json");
			writeFileSync(
				configPath,
				JSON.stringify({
					mcpServers: {
						valid: { type: "http", url: "https://example.com" },
						invalid: { url: "https://missing-type.com" }, // Missing type
					},
				}),
			);

			const result = loadAndValidateMcpConfigFile(configPath);

			expect(result.success).toBe(true);
			expect(result.validationResult?.isValid).toBe(false);
			expect(result.config?.mcpServers.valid).toBeDefined();
			expect(result.config?.mcpServers.invalid).toBeUndefined();
			expect(result.validationResult?.invalidServers).toHaveLength(1);
		});
	});

	describe("loadAndValidateMcpConfigs", () => {
		const testDir = join(process.cwd(), "test-tmp-mcp-configs");

		beforeEach(() => {
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("should auto-detect .mcp.json in working directory", () => {
			const workDir = join(testDir, "workspace");
			mkdirSync(workDir, { recursive: true });
			writeFileSync(
				join(workDir, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						"auto-detected": { type: "http", url: "https://example.com" },
					},
				}),
			);

			const result = loadAndValidateMcpConfigs(workDir);

			expect(Object.keys(result.validServers)).toContain("auto-detected");
		});

		it("should merge configs with later paths overriding earlier ones", () => {
			const workDir = join(testDir, "workspace");
			const extraConfigPath = join(testDir, "extra.json");
			mkdirSync(workDir, { recursive: true });

			// Base config in working directory
			writeFileSync(
				join(workDir, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						server1: { type: "http", url: "https://base.com" },
						server2: { type: "http", url: "https://base.com" },
					},
				}),
			);

			// Override config
			writeFileSync(
				extraConfigPath,
				JSON.stringify({
					mcpServers: {
						server1: { type: "http", url: "https://override.com" },
						server3: { command: "node", args: ["new.js"] },
					},
				}),
			);

			const result = loadAndValidateMcpConfigs(workDir, extraConfigPath);

			expect(result.validServers.server1).toEqual({
				type: "http",
				url: "https://override.com",
			});
			expect(result.validServers.server2).toEqual({
				type: "http",
				url: "https://base.com",
			});
			expect(result.validServers.server3).toBeDefined();
		});

		it("should collect errors from multiple files", () => {
			const config1 = join(testDir, "config1.json");
			const config2 = join(testDir, "config2.json");

			writeFileSync(
				config1,
				JSON.stringify({
					mcpServers: {
						invalid1: { url: "https://no-type.com" },
					},
				}),
			);
			writeFileSync(
				config2,
				JSON.stringify({
					mcpServers: {
						invalid2: { url: "https://also-no-type.com" },
					},
				}),
			);

			const result = loadAndValidateMcpConfigs(undefined, [config1, config2]);

			expect(result.allInvalidServers).toHaveLength(2);
			expect(result.allInvalidServers[0].error).toContain(config1);
			expect(result.allInvalidServers[1].error).toContain(config2);
		});

		it("should handle parse errors gracefully", () => {
			const validConfig = join(testDir, "valid.json");
			const invalidConfig = join(testDir, "invalid.json");

			writeFileSync(
				validConfig,
				JSON.stringify({
					mcpServers: {
						valid: { type: "http", url: "https://example.com" },
					},
				}),
			);
			writeFileSync(invalidConfig, "{ broken json }");

			const result = loadAndValidateMcpConfigs(undefined, [
				validConfig,
				invalidConfig,
			]);

			expect(result.parseErrors).toHaveLength(1);
			expect(result.parseErrors[0].path).toBe(invalidConfig);
			expect(result.validServers.valid).toBeDefined();
		});
	});

	describe("formatValidationErrorsForLinear", () => {
		it("should format errors for Linear display", () => {
			const invalidServers = [
				{
					serverName: "sentry",
					isValid: false,
					error: "[/path/.mcp.json] Missing type field",
				},
			];
			const parseErrors = [
				{ path: "/path/invalid.json", error: "Invalid JSON" },
			];

			const message = formatValidationErrorsForLinear(
				invalidServers,
				parseErrors,
			);

			expect(message).toContain("MCP Configuration Validation Errors");
			expect(message).toContain("sentry");
			expect(message).toContain("Missing type field");
			expect(message).toContain("Invalid JSON");
			expect(message).toContain("How to Fix");
			expect(message).toContain("http");
			expect(message).toContain("sse");
		});

		it("should handle empty errors gracefully", () => {
			const message = formatValidationErrorsForLinear([], []);

			expect(message).toContain("MCP Configuration Validation Errors");
			expect(message).toContain("How to Fix");
		});
	});
});
