import type { ComplexityInput, ComplexityScore } from "./types.js";

const COMPLEXITY_KEYWORDS = [
	"refactor",
	"migrate",
	"redesign",
	"architecture",
	"integration",
	"multiple files",
	"cross-cutting",
	"breaking change",
	"performance",
	"security",
];

const ZERO_SCORE_CLASSIFICATIONS = ["question", "documentation", "transient"];

const DEFAULT_THRESHOLD = 60;

export function scoreComplexity(
	input: ComplexityInput,
	threshold: number = DEFAULT_THRESHOLD,
): ComplexityScore {
	const { classification, issueDescription } = input;

	// Zero-score classifications never need a team
	if (ZERO_SCORE_CLASSIFICATIONS.includes(classification)) {
		return {
			score: 0,
			useTeam: false,
			reasoning: `Classification "${classification}" does not require team orchestration`,
			suggestedTeamSize: 0,
		};
	}

	let score = 0;
	const reasons: string[] = [];

	// Orchestrator always scores high
	if (classification === "orchestrator") {
		score += 80;
		reasons.push("orchestrator classification requires team coordination");
	}

	// Debugger scores moderate-high
	if (classification === "debugger") {
		score += 50;
		reasons.push(
			"debugger classification benefits from parallel investigation",
		);
	}

	// Code classification: check description length
	if (classification === "code") {
		if (issueDescription.length > 2000) {
			score += 40;
			reasons.push("long description indicates complex requirements");
		} else if (issueDescription.length > 800) {
			score += 20;
			reasons.push("moderate description length suggests some complexity");
		}
	}

	// Check for complexity keywords in the description
	const lowerDescription = issueDescription.toLowerCase();
	for (const keyword of COMPLEXITY_KEYWORDS) {
		if (lowerDescription.includes(keyword)) {
			score += 10;
			reasons.push(`contains complexity keyword "${keyword}"`);
		}
	}

	const useTeam = score >= threshold;
	const suggestedTeamSize = score >= 80 ? 4 : score >= 60 ? 3 : 2;

	return {
		score,
		useTeam,
		reasoning: reasons.join("; "),
		suggestedTeamSize,
	};
}
