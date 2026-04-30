import { describe, expect, it, vi } from "vitest";
import {
	type GhCliExecutor,
	GhCliTokenResolver,
} from "../src/GhCliTokenResolver.js";

describe("GhCliTokenResolver", () => {
	it("returns the trimmed token from `gh auth token`", async () => {
		const exec: GhCliExecutor = vi
			.fn()
			.mockResolvedValue({ code: 0, stdout: "gho_test_token\n" });
		const resolver = new GhCliTokenResolver({ exec });

		const token = await resolver.getToken();
		expect(token).toBe("gho_test_token");
		expect(exec).toHaveBeenCalledWith("gh", ["auth", "token"]);
	});

	it("caches the token within the TTL window", async () => {
		const exec = vi
			.fn<GhCliExecutor>()
			.mockResolvedValue({ code: 0, stdout: "gho_cached" });
		const resolver = new GhCliTokenResolver({ exec, ttlMs: 60_000 });

		await resolver.getToken();
		await resolver.getToken();
		await resolver.getToken();
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("re-fetches after the TTL expires", async () => {
		let nowOverride = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => nowOverride);

		const exec = vi
			.fn<GhCliExecutor>()
			.mockResolvedValueOnce({ code: 0, stdout: "first" })
			.mockResolvedValueOnce({ code: 0, stdout: "second" });
		const resolver = new GhCliTokenResolver({ exec, ttlMs: 1_000 });

		expect(await resolver.getToken()).toBe("first");
		nowOverride += 2_000;
		expect(await resolver.getToken()).toBe("second");
		expect(exec).toHaveBeenCalledTimes(2);
	});

	it("returns null on non-zero exit and does not cache", async () => {
		const exec = vi.fn<GhCliExecutor>().mockResolvedValue({
			code: 1,
			stdout: "",
		});
		const resolver = new GhCliTokenResolver({ exec });

		expect(await resolver.getToken()).toBeNull();
		expect(await resolver.getToken()).toBeNull();
		expect(exec).toHaveBeenCalledTimes(2);
	});

	it("returns null when `gh` is missing (exec rejects)", async () => {
		const exec = vi.fn<GhCliExecutor>().mockRejectedValue(new Error("ENOENT"));
		const resolver = new GhCliTokenResolver({ exec });

		expect(await resolver.getToken()).toBeNull();
	});

	it("returns null on empty stdout (gh authed but no token printed)", async () => {
		const exec = vi
			.fn<GhCliExecutor>()
			.mockResolvedValue({ code: 0, stdout: "   \n" });
		const resolver = new GhCliTokenResolver({ exec });

		expect(await resolver.getToken()).toBeNull();
	});

	it("dedupes concurrent in-flight calls into a single exec", async () => {
		let resolveExec: (r: { code: number; stdout: string }) => void;
		const exec = vi.fn<GhCliExecutor>().mockImplementation(
			() =>
				new Promise((r) => {
					resolveExec = r;
				}),
		);
		const resolver = new GhCliTokenResolver({ exec });

		const a = resolver.getToken();
		const b = resolver.getToken();
		// biome-ignore lint/style/noNonNullAssertion: set inside the mock above
		resolveExec!({ code: 0, stdout: "shared" });

		expect(await a).toBe("shared");
		expect(await b).toBe("shared");
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("invalidate() drops the cache so the next call re-fetches", async () => {
		const exec = vi
			.fn<GhCliExecutor>()
			.mockResolvedValueOnce({ code: 0, stdout: "first" })
			.mockResolvedValueOnce({ code: 0, stdout: "second" });
		const resolver = new GhCliTokenResolver({ exec });

		expect(await resolver.getToken()).toBe("first");
		resolver.invalidate();
		expect(await resolver.getToken()).toBe("second");
	});
});
