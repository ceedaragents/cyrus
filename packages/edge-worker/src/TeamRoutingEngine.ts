/**
 * TeamRoutingEngine - Evaluates routing rules and scores issue complexity
 * to determine the execution pattern for team-based development.
 */

export type ComplexityScore = "S" | "M" | "L" | "XL";

export interface TeamRoutingDecision {
	pattern: "single" | "subagents" | "agent-team" | "orchestrator";
	agents: string[];
	modelByRole: Record<string, string>;
	qualityGates?: { beforeMerge?: string[]; requiredChecks?: string[] };
	reasoning: string;
}

interface RoutingRule {
	match: {
		labels?: string[];
		complexity?: ComplexityScore[];
	};
	pattern: string;
	agents?: string[];
	description?: string;
	readOnly?: boolean;
}

interface RoutingDefaults {
	pattern: string;
	agents: string[];
}

const COMPLEXITY_KEYWORDS = [
	"refactor",
	"migration",
	"redesign",
	"overhaul",
	"rewrite",
	"rearchitect",
];

const FILE_PATH_PATTERN = /(?:[\w-]+\/)+[\w-]+\.\w+/g;

export class TeamRoutingEngine {
	/**
	 * Score issue complexity using heuristics.
	 */
	scoreComplexity(
		issueTitle: string,
		issueDescription: string,
		issueLabels: string[],
	): ComplexityScore {
		// 1. Check labels first (explicit complexity wins)
		const complexityLabels: ComplexityScore[] = ["S", "M", "L", "XL"];
		for (const label of issueLabels) {
			const upper = label.toUpperCase();
			if (complexityLabels.includes(upper as ComplexityScore)) {
				return upper as ComplexityScore;
			}
		}

		// 2. Base score from description length
		const fullText = `${issueTitle} ${issueDescription}`;
		const descLength = issueDescription.length;
		let score: ComplexityScore;

		if (descLength < 200) {
			score = "S";
		} else if (descLength < 800) {
			score = "M";
		} else if (descLength < 2000) {
			score = "L";
		} else {
			score = "XL";
		}

		// 3. Keyword boosters
		const lowerText = fullText.toLowerCase();
		const hasComplexityKeyword = COMPLEXITY_KEYWORDS.some((kw) =>
			lowerText.includes(kw),
		);
		if (hasComplexityKeyword) {
			score = this.bumpComplexity(score);
		}

		// 4. File/module reference count
		const fileMatches = fullText.match(FILE_PATH_PATTERN) || [];
		if (fileMatches.length > 5) {
			score = this.bumpComplexity(score);
		}

		return score;
	}

	/**
	 * Evaluate routing rules against issue metadata.
	 * First matching rule wins. Falls back to defaults if no match.
	 */
	evaluateRules(
		rules: RoutingRule[],
		issueLabels: string[],
		complexityScore: ComplexityScore,
		defaults: RoutingDefaults,
	): TeamRoutingDecision {
		const lowercaseLabels = issueLabels.map((l) => l.toLowerCase());

		for (const rule of rules) {
			if (this.ruleMatches(rule, lowercaseLabels, complexityScore)) {
				return {
					pattern: rule.pattern as TeamRoutingDecision["pattern"],
					agents: rule.agents || defaults.agents,
					modelByRole: {},
					reasoning: `Matched rule: ${rule.description || JSON.stringify(rule.match)}`,
				};
			}
		}

		// No rule matched, use defaults
		return {
			pattern: defaults.pattern as TeamRoutingDecision["pattern"],
			agents: defaults.agents,
			modelByRole: {},
			reasoning: "No routing rule matched, using defaults",
		};
	}

	private ruleMatches(
		rule: RoutingRule,
		lowercaseLabels: string[],
		complexityScore: ComplexityScore,
	): boolean {
		const hasLabelConstraint =
			rule.match.labels && rule.match.labels.length > 0;
		const hasComplexityConstraint =
			rule.match.complexity && rule.match.complexity.length > 0;

		// If no constraints, rule always matches (catch-all)
		if (!hasLabelConstraint && !hasComplexityConstraint) {
			return true;
		}

		let labelMatch = true;
		let complexityMatch = true;

		if (hasLabelConstraint) {
			// ALL rule labels must be present in issue labels
			labelMatch = rule.match.labels!.every((ruleLabel) =>
				lowercaseLabels.includes(ruleLabel.toLowerCase()),
			);
		}

		if (hasComplexityConstraint) {
			complexityMatch = rule.match.complexity!.includes(complexityScore);
		}

		// If both constraints exist, both must match
		if (hasLabelConstraint && hasComplexityConstraint) {
			return labelMatch && complexityMatch;
		}

		// If only one constraint, that one must match
		return hasLabelConstraint ? labelMatch : complexityMatch;
	}

	private bumpComplexity(score: ComplexityScore): ComplexityScore {
		switch (score) {
			case "S":
				return "M";
			case "M":
				return "L";
			case "L":
				return "XL";
			case "XL":
				return "XL";
		}
	}
}
