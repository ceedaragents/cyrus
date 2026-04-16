import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process so the module under test sees a controllable
// spawnSync. vi.mock is hoisted, so we use vi.hoisted to declare the mock
// handle before it is referenced inside the factory.
vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

import {
	checkLinuxSandboxRequirements,
	logSandboxRequirementFailures,
	resetSandboxRequirementsCacheForTesting,
} from "../src/sandbox-requirements";

const spawnSyncMock = vi.mocked(spawnSync);

type SpawnSyncCall = {
	command: string;
	args: string[];
};

function okResult(stdout = "/usr/bin/example\n"): SpawnSyncReturns<string> {
	return {
		pid: 1,
		output: [null, stdout, ""],
		stdout,
		stderr: "",
		status: 0,
		signal: null,
	} as SpawnSyncReturns<string>;
}

function failResult(stderr: string, status = 1): SpawnSyncReturns<string> {
	return {
		pid: 1,
		output: [null, "", stderr],
		stdout: "",
		stderr,
		status,
		signal: null,
	} as SpawnSyncReturns<string>;
}

function matchCall(call: [string, string[]]): SpawnSyncCall {
	return { command: call[0], args: call[1] };
}

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", {
		value: platform,
		configurable: true,
	});
}

function createMockLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		withContext: vi.fn(),
		getLevel: vi.fn(),
		setLevel: vi.fn(),
	};
}

describe("sandbox-requirements", () => {
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		resetSandboxRequirementsCacheForTesting();
		spawnSyncMock.mockReset();
		mockLogger = createMockLogger();
	});

	afterEach(() => {
		setPlatform(ORIGINAL_PLATFORM);
	});

	it("short-circuits to supported on non-Linux platforms without probing the host", () => {
		setPlatform("darwin");

		const result = checkLinuxSandboxRequirements();

		expect(result.supported).toBe(true);
		expect(result.platform).toBe("darwin");
		expect(result.failures).toEqual([]);
		expect(spawnSyncMock).not.toHaveBeenCalled();
	});

	it("reports success when socat and bubblewrap are both installed and the sandbox probe succeeds", () => {
		setPlatform("linux");

		// socat present, bwrap present, bwrap probe succeeds
		spawnSyncMock
			.mockReturnValueOnce(okResult("/usr/bin/socat\n"))
			.mockReturnValueOnce(okResult("/usr/bin/bwrap\n"))
			.mockReturnValueOnce(okResult(""));

		const result = checkLinuxSandboxRequirements();

		expect(result.supported).toBe(true);
		expect(result.failures).toEqual([]);

		const calls = spawnSyncMock.mock.calls.map((call) =>
			matchCall(call as [string, string[]]),
		);
		// First two calls probe PATH via `sh -c 'command -v <bin>'`
		expect(calls[0]).toEqual({
			command: "/bin/sh",
			args: ["-c", "command -v socat"],
		});
		expect(calls[1]).toEqual({
			command: "/bin/sh",
			args: ["-c", "command -v bwrap"],
		});
		// Third call runs the actual bwrap sandbox probe
		expect(calls[2]?.command).toBe("bwrap");
		expect(calls[2]?.args).toEqual([
			"--ro-bind",
			"/",
			"/",
			"--proc",
			"/proc",
			"--dev",
			"/dev",
			"--unshare-user",
			"--unshare-pid",
			"--unshare-net",
			"--",
			"true",
		]);
	});

	it("reports a socat failure with install guidance when socat is missing", () => {
		setPlatform("linux");

		spawnSyncMock
			.mockReturnValueOnce(failResult("not found", 1)) // socat missing
			.mockReturnValueOnce(okResult("/usr/bin/bwrap\n"))
			.mockReturnValueOnce(okResult(""));

		const result = checkLinuxSandboxRequirements();

		expect(result.supported).toBe(false);
		const socatFailure = result.failures.find((f) => f.check === "socat");
		expect(socatFailure).toBeDefined();
		expect(socatFailure?.message).toContain("socat");
		expect(socatFailure?.resolution).toContain("apt-get install");
	});

	it("reports a bubblewrap failure when bwrap is missing and skips the sandbox probe", () => {
		setPlatform("linux");

		spawnSyncMock
			.mockReturnValueOnce(okResult("/usr/bin/socat\n"))
			.mockReturnValueOnce(failResult("not found", 1)); // bwrap missing

		const result = checkLinuxSandboxRequirements();

		expect(result.supported).toBe(false);
		const bwrapFailure = result.failures.find((f) => f.check === "bubblewrap");
		expect(bwrapFailure).toBeDefined();
		expect(bwrapFailure?.message).toContain("bwrap");
		expect(bwrapFailure?.resolution).toContain("bubblewrap");

		// We should not have attempted to run the bwrap sandbox probe because
		// bwrap is not on PATH — doing so would just log a spurious ENOENT.
		expect(spawnSyncMock).toHaveBeenCalledTimes(2);
	});

	it("reports a bwrap-sandbox failure with kernel/AppArmor guidance when the probe fails", () => {
		setPlatform("linux");

		const stderr =
			"bwrap: setting up uid map: Permission denied\nanother line that should be ignored";
		spawnSyncMock
			.mockReturnValueOnce(okResult("/usr/bin/socat\n"))
			.mockReturnValueOnce(okResult("/usr/bin/bwrap\n"))
			.mockReturnValueOnce(failResult(stderr, 1));

		const result = checkLinuxSandboxRequirements();

		expect(result.supported).toBe(false);
		const probeFailure = result.failures.find(
			(f) => f.check === "bwrap-sandbox",
		);
		expect(probeFailure).toBeDefined();
		// Only the first stderr line should be surfaced in the short message
		expect(probeFailure?.message).toContain(
			"bwrap: setting up uid map: Permission denied",
		);
		expect(probeFailure?.message).not.toContain("another line");
		// Resolution mentions both kernel tuning and AppArmor profile paths
		expect(probeFailure?.resolution).toContain(
			"kernel.unprivileged_userns_clone",
		);
		expect(probeFailure?.resolution).toContain("/etc/apparmor.d/usr.bin.bwrap");
	});

	it("caches the result so repeated calls do not re-probe the host", () => {
		setPlatform("linux");

		spawnSyncMock
			.mockReturnValueOnce(okResult("/usr/bin/socat\n"))
			.mockReturnValueOnce(okResult("/usr/bin/bwrap\n"))
			.mockReturnValueOnce(okResult(""));

		const first = checkLinuxSandboxRequirements();
		const second = checkLinuxSandboxRequirements();

		expect(first).toBe(second);
		// Three probes for the initial call, zero for the second
		expect(spawnSyncMock).toHaveBeenCalledTimes(3);
	});

	describe("logSandboxRequirementFailures", () => {
		it("does nothing when requirements are supported", () => {
			logSandboxRequirementFailures(
				{ supported: true, platform: "linux", failures: [] },
				mockLogger as any,
			);
			expect(mockLogger.warn).not.toHaveBeenCalled();
		});

		it("logs warn-level messages with each failure's resolution on the first call", () => {
			logSandboxRequirementFailures(
				{
					supported: false,
					platform: "linux",
					failures: [
						{
							check: "socat",
							message: "`socat` is not installed or not on PATH.",
							resolution: "Install socat.",
						},
					],
				},
				mockLogger as any,
			);

			// Should have: 1 header, 1 "sessions will continue" line, 1 per-failure detail
			expect(mockLogger.warn).toHaveBeenCalledTimes(3);
			expect(mockLogger.warn.mock.calls[0]?.[0]).toContain(
				"Linux sandbox requirements are not met",
			);
			expect(mockLogger.warn.mock.calls[0]?.[0]).toContain(
				"skipping CLAUDE_CODE_SUBPROCESS_ENV_SCRUB",
			);
			expect(mockLogger.warn.mock.calls[2]?.[0]).toContain("[socat]");
			expect(mockLogger.warn.mock.calls[2]?.[0]).toContain("Install socat.");
		});

		it("is a no-op on subsequent calls within the same process", () => {
			const result = {
				supported: false,
				platform: "linux" as const,
				failures: [
					{
						check: "socat",
						message: "`socat` is not installed.",
						resolution: "Install socat.",
					},
				],
			};
			logSandboxRequirementFailures(result, mockLogger as any);
			logSandboxRequirementFailures(result, mockLogger as any);

			// Only the first call should have emitted warnings
			expect(mockLogger.warn).toHaveBeenCalledTimes(3);
		});
	});
});
