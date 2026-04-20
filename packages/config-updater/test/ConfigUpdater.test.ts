import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigUpdater } from "../src/ConfigUpdater.js";

vi.mock("../src/handlers/cyrusConfig.js", () => ({
	handleCyrusConfig: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/cyrusEnv.js", () => ({
	handleCyrusEnv: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/repository.js", () => ({
	handleRepository: vi.fn().mockResolvedValue({ success: true }),
	handleRepositoryDelete: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/testMcp.js", () => ({
	handleTestMcp: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/configureMcp.js", () => ({
	handleConfigureMcp: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/checkGh.js", () => ({
	handleCheckGh: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/checkGlab.js", () => ({
	handleCheckGlab: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../src/handlers/skills.js", () => ({
	handleUpdateSkill: vi.fn().mockResolvedValue({ success: true }),
	handleDeleteSkill: vi.fn().mockResolvedValue({ success: true }),
	handleListSkills: vi.fn().mockResolvedValue({ success: true }),
}));

describe("ConfigUpdater auth", () => {
	let fastify: FastifyInstance;

	beforeEach(() => {
		fastify = Fastify({ logger: false });
	});

	afterEach(async () => {
		await fastify.close();
	});

	it("accepts a string api key (backward compatibility)", async () => {
		const updater = new ConfigUpdater(fastify, "/tmp/cyrus-home", "static-key");
		updater.register();

		const ok = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer static-key" },
			payload: { repositories: [] },
		});
		expect(ok.statusCode).toBe(200);

		const bad = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer wrong-key" },
			payload: { repositories: [] },
		});
		expect(bad.statusCode).toBe(401);
	});

	it("re-reads the api key from the getter on every request", async () => {
		let currentKey = "first-key";
		const updater = new ConfigUpdater(
			fastify,
			"/tmp/cyrus-home",
			() => currentKey,
		);
		updater.register();

		const withFirst = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer first-key" },
			payload: { repositories: [] },
		});
		expect(withFirst.statusCode).toBe(200);

		currentKey = "rotated-key";

		const withOld = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer first-key" },
			payload: { repositories: [] },
		});
		expect(withOld.statusCode).toBe(401);

		const withRotated = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer rotated-key" },
			payload: { repositories: [] },
		});
		expect(withRotated.statusCode).toBe(200);
	});

	it("rejects requests when the getter returns an empty string", async () => {
		const updater = new ConfigUpdater(fastify, "/tmp/cyrus-home", () => "");
		updater.register();

		const withEmpty = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer anything" },
			payload: { repositories: [] },
		});
		expect(withEmpty.statusCode).toBe(401);

		const withBearerEmpty = await fastify.inject({
			method: "POST",
			url: "/api/update/cyrus-config",
			headers: { authorization: "Bearer " },
			payload: { repositories: [] },
		});
		expect(withBearerEmpty.statusCode).toBe(401);
	});

	it("enforces auth on DELETE and GET routes too", async () => {
		let currentKey = "k1";
		const updater = new ConfigUpdater(
			fastify,
			"/tmp/cyrus-home",
			() => currentKey,
		);
		updater.register();

		const delOk = await fastify.inject({
			method: "DELETE",
			url: "/api/update/repository",
			headers: { authorization: "Bearer k1" },
			payload: { repository_name: "x", linear_team_key: "T" },
		});
		expect(delOk.statusCode).toBe(200);

		currentKey = "k2";

		const delStale = await fastify.inject({
			method: "DELETE",
			url: "/api/update/repository",
			headers: { authorization: "Bearer k1" },
			payload: { repository_name: "x", linear_team_key: "T" },
		});
		expect(delStale.statusCode).toBe(401);

		const getStale = await fastify.inject({
			method: "GET",
			url: "/api/skills",
			headers: { authorization: "Bearer k1" },
		});
		expect(getStale.statusCode).toBe(401);

		const getFresh = await fastify.inject({
			method: "GET",
			url: "/api/skills",
			headers: { authorization: "Bearer k2" },
		});
		expect(getFresh.statusCode).toBe(200);
	});
});
