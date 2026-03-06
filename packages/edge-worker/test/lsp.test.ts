import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLspMcpConfig } from "../src/lsp/buildLspMcpConfig.js";
import {
	detectLanguages,
	SUPPORTED_LANGUAGES,
} from "../src/lsp/detectLanguages.js";

describe("LSP MCP integration", () => {
	let workspacePath: string;

	beforeEach(() => {
		const uniqueId = Date.now() + Math.random().toString(36).substring(7);
		workspacePath = join(tmpdir(), `test-workspace-lsp-${uniqueId}`);
		mkdirSync(workspacePath, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(workspacePath)) {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	describe("detectLanguages", () => {
		it("should return empty array for workspace with no language markers", () => {
			expect(detectLanguages(workspacePath)).toEqual([]);
		});

		it("should detect TypeScript from tsconfig.json", () => {
			writeFileSync(join(workspacePath, "tsconfig.json"), "{}");
			expect(detectLanguages(workspacePath)).toEqual(["typescript"]);
		});

		it("should detect TypeScript from tsconfig.base.json", () => {
			writeFileSync(join(workspacePath, "tsconfig.base.json"), "{}");
			expect(detectLanguages(workspacePath)).toEqual(["typescript"]);
		});

		it("should detect Go from go.mod", () => {
			writeFileSync(join(workspacePath, "go.mod"), "module example.com/test");
			expect(detectLanguages(workspacePath)).toEqual(["go"]);
		});

		it("should detect Rust from Cargo.toml", () => {
			writeFileSync(
				join(workspacePath, "Cargo.toml"),
				'[package]\nname = "test"',
			);
			expect(detectLanguages(workspacePath)).toEqual(["rust"]);
		});

		it("should detect Python from pyproject.toml", () => {
			writeFileSync(join(workspacePath, "pyproject.toml"), "[project]");
			expect(detectLanguages(workspacePath)).toEqual(["python"]);
		});

		it("should detect Python from requirements.txt", () => {
			writeFileSync(join(workspacePath, "requirements.txt"), "requests");
			expect(detectLanguages(workspacePath)).toEqual(["python"]);
		});

		it("should detect Python from setup.py", () => {
			writeFileSync(
				join(workspacePath, "setup.py"),
				"from setuptools import setup",
			);
			expect(detectLanguages(workspacePath)).toEqual(["python"]);
		});

		it("should detect multiple languages", () => {
			writeFileSync(join(workspacePath, "tsconfig.json"), "{}");
			writeFileSync(join(workspacePath, "go.mod"), "module test");
			writeFileSync(join(workspacePath, "Cargo.toml"), "[package]");
			const detected = detectLanguages(workspacePath);
			expect(detected).toContain("typescript");
			expect(detected).toContain("go");
			expect(detected).toContain("rust");
			expect(detected).toHaveLength(3);
		});

		it("should not duplicate language when multiple markers present", () => {
			writeFileSync(join(workspacePath, "pyproject.toml"), "[project]");
			writeFileSync(join(workspacePath, "requirements.txt"), "requests");
			const detected = detectLanguages(workspacePath);
			expect(detected).toEqual(["python"]);
		});
	});

	describe("buildLspMcpConfig", () => {
		it("should return empty config for workspace with no languages", () => {
			expect(buildLspMcpConfig(workspacePath)).toEqual({});
		});

		it("should return empty config for empty workspace path", () => {
			expect(buildLspMcpConfig("")).toEqual({});
		});

		it("should build TypeScript LSP config", () => {
			writeFileSync(join(workspacePath, "tsconfig.json"), "{}");
			const config = buildLspMcpConfig(workspacePath);

			expect(config).toHaveProperty("lsp-typescript");
			expect(config["lsp-typescript"]).toEqual({
				command: "mcp-language-server",
				args: [
					"--workspace",
					workspacePath,
					"--lsp",
					"typescript-language-server",
					"--",
					"--stdio",
				],
			});
		});

		it("should build Go LSP config without extra args", () => {
			writeFileSync(join(workspacePath, "go.mod"), "module test");
			const config = buildLspMcpConfig(workspacePath);

			expect(config).toHaveProperty("lsp-go");
			expect(config["lsp-go"]).toEqual({
				command: "mcp-language-server",
				args: ["--workspace", workspacePath, "--lsp", "gopls"],
			});
		});

		it("should build Rust LSP config without extra args", () => {
			writeFileSync(join(workspacePath, "Cargo.toml"), "[package]");
			const config = buildLspMcpConfig(workspacePath);

			expect(config).toHaveProperty("lsp-rust");
			expect(config["lsp-rust"]).toEqual({
				command: "mcp-language-server",
				args: ["--workspace", workspacePath, "--lsp", "rust-analyzer"],
			});
		});

		it("should build Python LSP config with --stdio", () => {
			writeFileSync(join(workspacePath, "pyproject.toml"), "[project]");
			const config = buildLspMcpConfig(workspacePath);

			expect(config).toHaveProperty("lsp-python");
			expect(config["lsp-python"]).toEqual({
				command: "mcp-language-server",
				args: [
					"--workspace",
					workspacePath,
					"--lsp",
					"pyright-langserver",
					"--",
					"--stdio",
				],
			});
		});

		it("should build configs for multiple detected languages", () => {
			writeFileSync(join(workspacePath, "tsconfig.json"), "{}");
			writeFileSync(join(workspacePath, "go.mod"), "module test");
			const config = buildLspMcpConfig(workspacePath);

			expect(Object.keys(config)).toHaveLength(2);
			expect(config).toHaveProperty("lsp-typescript");
			expect(config).toHaveProperty("lsp-go");
		});
	});

	describe("SUPPORTED_LANGUAGES", () => {
		it("should have entries for typescript, go, rust, and python", () => {
			expect(Object.keys(SUPPORTED_LANGUAGES)).toEqual([
				"typescript",
				"go",
				"rust",
				"python",
			]);
		});

		it("should have valid lspCommand for each language", () => {
			for (const config of Object.values(SUPPORTED_LANGUAGES)) {
				expect(config.lspCommand).toBeTruthy();
				expect(typeof config.lspCommand).toBe("string");
			}
		});

		it("should have at least one marker for each language", () => {
			for (const config of Object.values(SUPPORTED_LANGUAGES)) {
				expect(config.markers.length).toBeGreaterThan(0);
			}
		});
	});
});
