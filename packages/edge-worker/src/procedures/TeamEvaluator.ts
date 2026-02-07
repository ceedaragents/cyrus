import type { ISimpleAgentRunner } from "cyrus-core";
import { SimpleGeminiRunner } from "cyrus-gemini-runner";
import { SimpleClaudeRunner } from "cyrus-simple-agent-runner";

type TeamSizeResponse = "0" | "2" | "3" | "4";

export interface TeamEvaluationResult {
	useTeam: boolean;
	teamSize: number;
	reasoning: string;
}

export interface TeamEvaluatorConfig {
	cyrusHome: string;
	model?: string;
	timeoutMs?: number;
	runnerType?: "claude" | "gemini";
}

export class TeamEvaluator {
	private runner: ISimpleAgentRunner<TeamSizeResponse>;

	constructor(config: TeamEvaluatorConfig) {
		const runnerType = config.runnerType || "gemini";
		const defaultModel =
			runnerType === "claude" ? "haiku" : "gemini-2.5-flash-lite";
		const defaultFallbackModel =
			runnerType === "claude" ? "sonnet" : "gemini-2.0-flash-exp";

		const runnerConfig = {
			validResponses: ["0", "2", "3", "4"] as const,
			cyrusHome: config.cyrusHome,
			model: config.model || defaultModel,
			fallbackModel: defaultFallbackModel,
			systemPrompt: this.buildSystemPrompt(),
			maxTurns: 1,
			timeoutMs: config.timeoutMs || 10000,
		};

		this.runner =
			runnerType === "claude"
				? new SimpleClaudeRunner(runnerConfig)
				: new SimpleGeminiRunner(runnerConfig);
	}

	private buildSystemPrompt(): string {
		return `You are a team size evaluator for a software development agent system.

Your job is to decide the team size for a Linear issue. Agent teams spawn 2-4 parallel teammates coordinated by a lead agent. Teams handle context very well and should be used generously.

DEFAULT TO USING A TEAM. Most code tasks benefit from parallel work. Only use 0 (no team) for genuinely trivial work.

Team size guide:
- 0: ONLY for trivial tasks — simple one-liner fixes, pure questions, documentation typos
- 2: Standard tasks — most bug fixes, small features, single-component changes
- 3: Moderate tasks — multi-file features, refactoring, tasks touching 2-3 components
- 4: Complex tasks — cross-cutting changes, large features, multi-package work, architecture changes

When to use 0 (rare):
- Pure questions or information requests with no code changes
- Single-line typo or config value fix
- Documentation-only edits

When in doubt, prefer a LARGER team size. Teams parallelize well and the overhead is minimal.

If the user explicitly requests a team, agents, or parallel work, ALWAYS honor that with at least 2.

IMPORTANT: Respond with ONLY the number (0, 2, 3, or 4), nothing else.`;
	}

	async evaluate(input: {
		issueTitle: string;
		issueDescription: string;
		classification: string;
		labels?: string[];
	}): Promise<TeamEvaluationResult> {
		try {
			const labelStr = input.labels?.length
				? `\nLabels: ${input.labels.join(", ")}`
				: "";
			const query = `Evaluate this Linear issue for team assignment:

Classification: ${input.classification}
Title: ${input.issueTitle}
${labelStr}
Description:
${input.issueDescription}`;

			const result = await this.runner.query(query);
			const teamSize = parseInt(result.response, 10);

			return {
				useTeam: teamSize > 0,
				teamSize,
				reasoning: `AI evaluated team size as ${teamSize} (model response: "${result.response}")`,
			};
		} catch (error) {
			console.log(
				"[TeamEvaluator] Error during evaluation, defaulting to no team:",
				error,
			);
			return {
				useTeam: false,
				teamSize: 0,
				reasoning: `Fallback to no team due to error: ${error}`,
			};
		}
	}
}
