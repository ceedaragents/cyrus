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

Your job is to decide whether a Linear issue requires an agent team (multiple parallel workers) or can be handled by a single agent.

Agent teams spawn 2-4 parallel teammates coordinated by a lead agent. Teams are useful for:
- Complex multi-file changes spanning multiple modules or packages
- Large refactoring efforts that touch many parts of the codebase
- Features requiring both frontend and backend changes
- Debugging complex issues where multiple hypotheses need investigation
- Implementation work with clear parallelizable subtasks

Teams are NOT useful for:
- Simple bug fixes (single file, obvious cause)
- Questions or information requests
- Documentation-only changes
- Small tweaks, config changes, or single-file modifications

Respond with ONLY a single number representing the team size:
- 0: No team needed (single agent can handle it)
- 2: Moderate complexity (2 teammates)
- 3: High complexity (3 teammates)
- 4: Very high complexity (4 teammates)

Consider:
1. The scope of changes described in the issue
2. How many components, files, or modules are likely involved
3. Whether subtasks can be parallelized
4. The classification of the issue (e.g., "code", "planning", "question")
5. Issue labels that hint at complexity
6. If the user explicitly requests a team, agents, or parallel work, ALWAYS honor that request with a team size of at least 2

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
