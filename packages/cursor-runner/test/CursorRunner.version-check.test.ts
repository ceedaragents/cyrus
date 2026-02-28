import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return {
		...actual,
		spawn: spawnMock,
		spawnSync: spawnSyncMock,
	};
});

import { CursorRunner } from "../src/CursorRunner.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cursor-runner-version-check-"));
	tempDirs.push(dir);
	return dir;
}

function createMockChildProcess(): {
	stdout: Readable;
	stderr: { on: () => void };
	on: (ev: string, fn: (code?: number) => void) => unknown;
} {
	const stdout = new Readable({ read() {} });
	stdout.push(
		'{"type":"init","session_id":"test-version-check","timestamp":"2026-02-14T00:00:00Z"}\n',
	);
	stdout.push('{"type":"result","status":"success"}\n');
	stdout.push(null);

	const handlers: { close?: (code?: number) => void } = {};
	return {
		stdout,
		stderr: { on: () => {} },
		on(ev: string, fn: (code?: number) => void) {
			if (ev === "close") handlers.close = fn;
			setImmediate(() => {
				if (ev === "close" && handlers.close) handlers.close(0);
			});
			return { on: () => {} };
		},
	};
}

describe("CursorRunner startup", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		delete process.env.CYRUS_CURSOR_MOCK;
		spawnSyncMock.mockReset();
		spawnMock.mockReset();
	});

	it("starts without a cursor-agent version preflight", async () => {
		const workspace = createTempDir();

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: "",
		});
		spawnMock.mockReturnValue(createMockChildProcess());

		const messages: unknown[] = [];
		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory: workspace,
			onMessage: (m) => messages.push(m),
			onError: () => {}, // prevent unhandled error emission from failing test
		});

		await runner.start("test startup");

		const versionCalls = spawnSyncMock.mock.calls.filter(
			(call) => call[1]?.[0] === "--version",
		);
		expect(versionCalls).toHaveLength(0);
		expect(spawnMock).toHaveBeenCalled();

		const errorResult = messages.find(
			(m) =>
				typeof m === "object" &&
				m !== null &&
				"type" in m &&
				m.type === "result" &&
				"subtype" in m &&
				m.subtype === "error_during_execution",
		);
		expect(errorResult).toBeUndefined();
	});

	it("starts normally with no version override configured", async () => {
		const workspace = createTempDir();

		spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
			if (args[1] === "list") {
				return { status: 0, stdout: "", stderr: "" };
			}
			return { status: 0, stdout: "", stderr: "" };
		});

		spawnMock.mockReturnValue(createMockChildProcess());

		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory: workspace,
		});

		await runner.start("test start");

		const versionCalls = spawnSyncMock.mock.calls.filter(
			(call) => call[1]?.[0] === "--version",
		);
		expect(versionCalls).toHaveLength(0);
		expect(spawnMock).toHaveBeenCalled();
	});

	it("uses mock mode when CYRUS_CURSOR_MOCK is set", async () => {
		const workspace = createTempDir();
		process.env.CYRUS_CURSOR_MOCK = "1";

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "  docs: loaded\n",
			stderr: "",
		});

		const runner = new CursorRunner({
			cyrusHome: "/tmp/cyrus",
			workingDirectory: workspace,
		});

		await runner.start("test mock");

		const versionCalls = spawnSyncMock.mock.calls.filter(
			(call) => call[1]?.[0] === "--version",
		);
		expect(versionCalls).toHaveLength(0);
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
