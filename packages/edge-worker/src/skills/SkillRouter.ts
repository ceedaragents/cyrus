import type {
	ISkillRouter,
	ISkillRoutingStrategy,
	SkillDefinition,
	SkillRoutingContext,
} from "cyrus-core";

/**
 * Always strategy - skill is loaded for every session.
 */
export class AlwaysRoutingStrategy implements ISkillRoutingStrategy {
	readonly strategyName = "always" as const;

	matches(): boolean {
		return true;
	}
}

/**
 * Label strategy - skill is loaded when issue has any matching label.
 * Case-insensitive matching.
 */
export class LabelRoutingStrategy implements ISkillRoutingStrategy {
	readonly strategyName = "label" as const;

	matches(skill: SkillDefinition, context: SkillRoutingContext): boolean {
		const requiredLabels = skill.routing.labels;
		if (!requiredLabels || requiredLabels.length === 0) return false;

		const issueLabels = context.labels?.map((l) => l.toLowerCase()) || [];
		return requiredLabels.some((label) =>
			issueLabels.includes(label.toLowerCase()),
		);
	}
}

/**
 * Team strategy - skill is loaded for specific Linear teams.
 * Case-insensitive matching.
 */
export class TeamRoutingStrategy implements ISkillRoutingStrategy {
	readonly strategyName = "team" as const;

	matches(skill: SkillDefinition, context: SkillRoutingContext): boolean {
		const requiredTeams = skill.routing.teams;
		if (!requiredTeams || requiredTeams.length === 0) return false;
		if (!context.teamKey) return false;

		return requiredTeams.some(
			(team) => team.toLowerCase() === context.teamKey!.toLowerCase(),
		);
	}
}

/**
 * Repository strategy - skill is loaded for specific repositories.
 * Matches against repository ID or name, case-insensitive.
 */
export class RepositoryRoutingStrategy implements ISkillRoutingStrategy {
	readonly strategyName = "repository" as const;

	matches(skill: SkillDefinition, context: SkillRoutingContext): boolean {
		const requiredRepos = skill.routing.repositories;
		if (!requiredRepos || requiredRepos.length === 0) return false;

		const repoId = context.repositoryId?.toLowerCase();
		const repoName = context.repositoryName?.toLowerCase();

		return requiredRepos.some((repo) => {
			const lower = repo.toLowerCase();
			return lower === repoId || lower === repoName;
		});
	}
}

/**
 * Keyword strategy - skill is loaded when issue title or description
 * contains any matching keyword. Case-insensitive.
 */
export class KeywordRoutingStrategy implements ISkillRoutingStrategy {
	readonly strategyName = "keyword" as const;

	matches(skill: SkillDefinition, context: SkillRoutingContext): boolean {
		const keywords = skill.routing.keywords;
		if (!keywords || keywords.length === 0) return false;

		const searchText = [
			context.issueTitle || "",
			context.issueDescription || "",
		]
			.join(" ")
			.toLowerCase();

		return keywords.some((keyword) =>
			searchText.includes(keyword.toLowerCase()),
		);
	}
}

/**
 * Routes skills to sessions based on their routing strategy.
 *
 * Follows Open/Closed Principle: new strategies are added by registering
 * new ISkillRoutingStrategy implementations, not by modifying this class.
 *
 * Follows Dependency Inversion: depends on ISkillRoutingStrategy abstraction.
 */
export class SkillRouter implements ISkillRouter {
	private strategies: Map<string, ISkillRoutingStrategy>;

	constructor(strategies?: ISkillRoutingStrategy[]) {
		this.strategies = new Map();

		// Register default strategies
		const defaults: ISkillRoutingStrategy[] = strategies || [
			new AlwaysRoutingStrategy(),
			new LabelRoutingStrategy(),
			new TeamRoutingStrategy(),
			new RepositoryRoutingStrategy(),
			new KeywordRoutingStrategy(),
		];

		for (const strategy of defaults) {
			this.strategies.set(strategy.strategyName, strategy);
		}
	}

	/**
	 * Register a new routing strategy.
	 * Enables extension without modification (Open/Closed).
	 */
	registerStrategy(strategy: ISkillRoutingStrategy): void {
		this.strategies.set(strategy.strategyName, strategy);
	}

	resolveSkills(
		skills: SkillDefinition[],
		context: SkillRoutingContext,
	): SkillDefinition[] {
		return skills.filter((skill) => {
			const strategy = this.strategies.get(skill.routing.strategy);
			if (!strategy) {
				// Unknown strategy - skip the skill
				return false;
			}
			return strategy.matches(skill, context);
		});
	}
}
