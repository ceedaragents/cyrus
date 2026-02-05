import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import type { RepositoryConfig } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginService } from "../src/PluginService.js";

describe("PluginService", () => {
	let pluginService: PluginService;
	let testCyrusHome: string;
	let pluginsDir: string;

	beforeEach(async () => {
		// Create a unique test directory for each test
		testCyrusHome = join(
			tmpdir(),
			`cyrus-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		pluginsDir = join(testCyrusHome, "plugins");

		// Create the test directories
		mkdirSync(pluginsDir, { recursive: true });

		pluginService = new PluginService(testCyrusHome);
	});

	afterEach(async () => {
		// Clean up test directory
		if (existsSync(testCyrusHome)) {
			rmSync(testCyrusHome, { recursive: true, force: true });
		}
	});

	describe("getPluginsDirectory", () => {
		it("should return the correct plugins directory path", () => {
			expect(pluginService.getPluginsDirectory()).toBe(pluginsDir);
		});
	});

	describe("ensurePluginsDirectory", () => {
		it("should create plugins directory if it does not exist", async () => {
			// Remove the plugins directory
			rmSync(pluginsDir, { recursive: true, force: true });

			expect(existsSync(pluginsDir)).toBe(false);

			await pluginService.ensurePluginsDirectory();

			expect(existsSync(pluginsDir)).toBe(true);
		});

		it("should not fail if plugins directory already exists", async () => {
			expect(existsSync(pluginsDir)).toBe(true);

			await expect(
				pluginService.ensurePluginsDirectory(),
			).resolves.not.toThrow();
		});
	});

	describe("validatePlugin", () => {
		it("should return invalid if plugin directory does not exist", async () => {
			const result = await pluginService.validatePlugin("/nonexistent/path");

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("does not exist");
		});

		it("should return invalid if path is not a directory", async () => {
			const filePath = join(pluginsDir, "not-a-dir");
			writeFileSync(filePath, "content");

			const result = await pluginService.validatePlugin(filePath);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("not a directory");
		});

		it("should return invalid if .claude-plugin/plugin.json is missing", async () => {
			const pluginPath = join(pluginsDir, "test-plugin");
			mkdirSync(pluginPath, { recursive: true });

			const result = await pluginService.validatePlugin(pluginPath);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("manifest not found");
		});

		it("should return invalid if plugin.json has no name field", async () => {
			const pluginPath = join(pluginsDir, "test-plugin");
			const manifestDir = join(pluginPath, ".claude-plugin");
			mkdirSync(manifestDir, { recursive: true });
			writeFileSync(
				join(manifestDir, "plugin.json"),
				JSON.stringify({ version: "1.0.0" }),
			);

			const result = await pluginService.validatePlugin(pluginPath);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("missing required 'name' field");
		});

		it("should return valid with manifest for a valid plugin", async () => {
			const pluginPath = join(pluginsDir, "test-plugin");
			const manifestDir = join(pluginPath, ".claude-plugin");
			mkdirSync(manifestDir, { recursive: true });

			const manifest = {
				name: "test-plugin",
				version: "1.0.0",
				description: "A test plugin",
			};
			writeFileSync(join(manifestDir, "plugin.json"), JSON.stringify(manifest));

			const result = await pluginService.validatePlugin(pluginPath);

			expect(result.isValid).toBe(true);
			expect(result.manifest).toEqual(manifest);
		});

		it("should resolve tilde paths", async () => {
			// This test creates a plugin in a path that simulates tilde expansion
			const pluginPath = join(pluginsDir, "test-plugin");
			const manifestDir = join(pluginPath, ".claude-plugin");
			mkdirSync(manifestDir, { recursive: true });

			const manifest = { name: "test-plugin" };
			writeFileSync(join(manifestDir, "plugin.json"), JSON.stringify(manifest));

			const result = await pluginService.validatePlugin(pluginPath);
			expect(result.isValid).toBe(true);
		});
	});

	describe("installFromZip", () => {
		function createTestPluginZip(
			pluginName: string,
			manifest: object,
			nested?: boolean,
		): string {
			const zip = new AdmZip();

			const basePath = nested ? `${pluginName}/` : "";
			zip.addFile(
				`${basePath}.claude-plugin/plugin.json`,
				Buffer.from(JSON.stringify(manifest)),
			);
			zip.addFile(
				`${basePath}skills/test-skill/SKILL.md`,
				Buffer.from("# Test Skill"),
			);

			return zip.toBuffer().toString("base64");
		}

		it("should install a valid plugin from zip", async () => {
			const manifest = { name: "my-plugin", version: "1.0.0" };
			const zipContent = createTestPluginZip("my-plugin", manifest, false);

			const result = await pluginService.installFromZip(zipContent);

			expect(result.success).toBe(true);
			expect(result.pluginName).toBe("my-plugin");
			expect(result.pluginPath).toBe(join(pluginsDir, "my-plugin"));
			expect(existsSync(join(pluginsDir, "my-plugin"))).toBe(true);
		});

		it("should install a nested plugin from zip (GitHub archive style)", async () => {
			const manifest = { name: "nested-plugin", version: "1.0.0" };
			const zipContent = createTestPluginZip("nested-plugin", manifest, true);

			const result = await pluginService.installFromZip(zipContent);

			expect(result.success).toBe(true);
			expect(result.pluginName).toBe("nested-plugin");
		});

		it("should use provided name over manifest name", async () => {
			const manifest = { name: "manifest-name", version: "1.0.0" };
			const zipContent = createTestPluginZip("manifest-name", manifest, false);

			const result = await pluginService.installFromZip(
				zipContent,
				"custom-name",
			);

			expect(result.success).toBe(true);
			expect(result.pluginName).toBe("custom-name");
			expect(existsSync(join(pluginsDir, "custom-name"))).toBe(true);
		});

		it("should replace existing plugin if already installed", async () => {
			const manifest1 = { name: "my-plugin", version: "1.0.0" };
			const manifest2 = { name: "my-plugin", version: "2.0.0" };

			// Install first version
			const zip1 = createTestPluginZip("my-plugin", manifest1, false);
			await pluginService.installFromZip(zip1);

			// Install second version
			const zip2 = createTestPluginZip("my-plugin", manifest2, false);
			const result = await pluginService.installFromZip(zip2);

			expect(result.success).toBe(true);

			// Verify new version
			const validation = await pluginService.validatePlugin(
				join(pluginsDir, "my-plugin"),
			);
			expect(validation.manifest?.version).toBe("2.0.0");
		});

		it("should fail for invalid zip with no plugin root", async () => {
			const zip = new AdmZip();
			zip.addFile("random-file.txt", Buffer.from("content"));
			const zipContent = zip.toBuffer().toString("base64");

			const result = await pluginService.installFromZip(zipContent);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Could not find plugin root");
		});
	});

	describe("listPlugins", () => {
		it("should return empty array when no plugins installed", async () => {
			const plugins = await pluginService.listPlugins();
			expect(plugins).toEqual([]);
		});

		it("should list all valid plugins", async () => {
			// Create two valid plugins
			for (const name of ["plugin-a", "plugin-b"]) {
				const pluginPath = join(pluginsDir, name);
				const manifestDir = join(pluginPath, ".claude-plugin");
				mkdirSync(manifestDir, { recursive: true });
				writeFileSync(
					join(manifestDir, "plugin.json"),
					JSON.stringify({ name, version: "1.0.0" }),
				);
			}

			const plugins = await pluginService.listPlugins();

			expect(plugins).toHaveLength(2);
			expect(plugins.map((p) => p.name).sort()).toEqual([
				"plugin-a",
				"plugin-b",
			]);
			expect(plugins.every((p) => p.manifest !== null)).toBe(true);
		});

		it("should include invalid plugins with null manifest", async () => {
			// Create one valid and one invalid plugin
			const validPath = join(pluginsDir, "valid-plugin");
			const validManifest = join(validPath, ".claude-plugin");
			mkdirSync(validManifest, { recursive: true });
			writeFileSync(
				join(validManifest, "plugin.json"),
				JSON.stringify({ name: "valid-plugin" }),
			);

			const invalidPath = join(pluginsDir, "invalid-plugin");
			mkdirSync(invalidPath, { recursive: true });
			// No plugin.json

			const plugins = await pluginService.listPlugins();

			expect(plugins).toHaveLength(2);

			const valid = plugins.find((p) => p.name === "valid-plugin");
			const invalid = plugins.find((p) => p.name === "invalid-plugin");

			expect(valid?.manifest).not.toBeNull();
			expect(invalid?.manifest).toBeNull();
		});

		it("should skip hidden and temp directories", async () => {
			// Create a hidden directory and a temp directory
			mkdirSync(join(pluginsDir, ".hidden-plugin"), { recursive: true });
			mkdirSync(join(pluginsDir, ".temp-123"), { recursive: true });

			const plugins = await pluginService.listPlugins();
			expect(plugins).toHaveLength(0);
		});
	});

	describe("deletePlugin", () => {
		it("should delete an existing plugin", async () => {
			const pluginPath = join(pluginsDir, "to-delete");
			const manifestDir = join(pluginPath, ".claude-plugin");
			mkdirSync(manifestDir, { recursive: true });
			writeFileSync(
				join(manifestDir, "plugin.json"),
				JSON.stringify({ name: "to-delete" }),
			);

			const result = await pluginService.deletePlugin("to-delete");

			expect(result.success).toBe(true);
			expect(existsSync(pluginPath)).toBe(false);
		});

		it("should return error if plugin not found", async () => {
			const result = await pluginService.deletePlugin("nonexistent");

			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	describe("resolvePluginsForLabels", () => {
		const baseRepository: RepositoryConfig = {
			id: "repo-1",
			name: "test-repo",
			repositoryPath: "/test/repo",
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			linearToken: "token",
			workspaceBaseDir: "/test/workspaces",
		};

		beforeEach(async () => {
			// Create test plugins
			for (const name of ["security-plugin", "doc-plugin", "shared-plugin"]) {
				const pluginPath = join(pluginsDir, name);
				const manifestDir = join(pluginPath, ".claude-plugin");
				mkdirSync(manifestDir, { recursive: true });
				writeFileSync(
					join(manifestDir, "plugin.json"),
					JSON.stringify({ name }),
				);
			}
		});

		it("should return empty array when no labels match", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					security: [`${pluginsDir}/security-plugin`],
				},
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["feature", "enhancement"],
				repository,
			);

			expect(plugins).toEqual([]);
		});

		it("should resolve plugins from pluginRouting by label", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					security: [`${pluginsDir}/security-plugin`],
					docs: [`${pluginsDir}/doc-plugin`],
				},
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["security", "feature"],
				repository,
			);

			expect(plugins).toHaveLength(1);
			expect(plugins[0].type).toBe("local");
			expect(plugins[0].path).toBe(`${pluginsDir}/security-plugin`);
		});

		it("should resolve plugins from plugins array by label", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				plugins: [
					{
						name: "security-plugin",
						path: `${pluginsDir}/security-plugin`,
						labels: ["security", "audit"],
						isActive: true,
					},
					{
						name: "doc-plugin",
						path: `${pluginsDir}/doc-plugin`,
						labels: ["docs"],
						isActive: true,
					},
				],
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["audit"],
				repository,
			);

			expect(plugins).toHaveLength(1);
			expect(plugins[0].path).toBe(`${pluginsDir}/security-plugin`);
		});

		it("should skip inactive plugins", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				plugins: [
					{
						name: "security-plugin",
						path: `${pluginsDir}/security-plugin`,
						labels: ["security"],
						isActive: false,
					},
				],
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["security"],
				repository,
			);

			expect(plugins).toEqual([]);
		});

		it("should perform case-insensitive label matching", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					Security: [`${pluginsDir}/security-plugin`],
				},
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["SECURITY"],
				repository,
			);

			expect(plugins).toHaveLength(1);
		});

		it("should not duplicate plugins when same plugin matches multiple labels", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					security: [`${pluginsDir}/shared-plugin`],
					audit: [`${pluginsDir}/shared-plugin`],
				},
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["security", "audit"],
				repository,
			);

			expect(plugins).toHaveLength(1);
		});

		it("should combine plugins from both pluginRouting and plugins array", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					security: [`${pluginsDir}/security-plugin`],
				},
				plugins: [
					{
						name: "doc-plugin",
						path: `${pluginsDir}/doc-plugin`,
						labels: ["docs"],
						isActive: true,
					},
				],
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["security", "docs"],
				repository,
			);

			expect(plugins).toHaveLength(2);
			expect(plugins.map((p) => p.path).sort()).toEqual([
				`${pluginsDir}/doc-plugin`,
				`${pluginsDir}/security-plugin`,
			]);
		});

		it("should resolve tilde paths to absolute paths", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					test: ["~/.cyrus/plugins/test-plugin"],
				},
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["test"],
				repository,
			);

			expect(plugins).toHaveLength(1);
			// The path should be resolved (no tilde)
			expect(plugins[0].path.startsWith("~")).toBe(false);
			expect(plugins[0].path).toContain(".cyrus/plugins/test-plugin");
		});

		it("should match multiple labels to multiple plugins", () => {
			const repository: RepositoryConfig = {
				...baseRepository,
				pluginRouting: {
					security: [`${pluginsDir}/security-plugin`],
					docs: [`${pluginsDir}/doc-plugin`],
				},
			};

			const plugins = pluginService.resolvePluginsForLabels(
				["security", "docs", "feature"],
				repository,
			);

			expect(plugins).toHaveLength(2);
		});
	});
});
