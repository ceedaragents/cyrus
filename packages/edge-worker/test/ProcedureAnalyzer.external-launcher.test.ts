import { beforeEach, describe, expect, it, vi } from "vitest";

const codexConfigs: Array<Record<string, unknown>> = [];
const codexQuery = vi.fn();

vi.mock("cyrus-codex-runner", () => ({
	SimpleCodexRunner: class {
		constructor(config: Record<string, unknown>) {
			codexConfigs.push(config);
		}

		query = codexQuery;
	},
}));

vi.mock("cyrus-simple-agent-runner", () => ({
	SimpleClaudeRunner: class {
		async query() {
			return { response: "question" };
		}
	},
}));

vi.mock("cyrus-gemini-runner", () => ({
	SimpleGeminiRunner: class {
		async query() {
			return { response: "question" };
		}
	},
}));

vi.mock("cyrus-cursor-runner", () => ({
	SimpleCursorRunner: class {
		async query() {
			return { response: "question" };
		}
	},
}));

import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";

describe("ProcedureAnalyzer - external launcher overrides", () => {
	beforeEach(() => {
		codexConfigs.length = 0;
		codexQuery.mockReset();
		codexQuery.mockResolvedValue({ response: "question" });
	});

	it("creates a codex analysis runner with the external launcher path when provided", async () => {
		const analyzer = new ProcedureAnalyzer({
			cyrusHome: "/test/.cyrus",
			runnerType: "codex",
		});

		const decision = await analyzer.determineRoutine("How does this work?", {
			runnerType: "codex",
			model: "gpt-5",
			fallbackModel: "gpt-5",
			workingDirectory: "/tmp/worktree",
			codexPath: "/tmp/codex-external-launcher",
		});

		expect(decision.classification).toBe("question");
		expect(decision.procedure.name).toBe("simple-question");
		expect(codexQuery).toHaveBeenCalledOnce();
		expect(codexConfigs.at(-1)).toMatchObject({
			model: "gpt-5",
			fallbackModel: "gpt-5",
			workingDirectory: "/tmp/worktree",
			codexPath: "/tmp/codex-external-launcher",
		});
	});
});
