import type { RepositoryConfig } from "cyrus-core";

/**
 * Fuzzy matching between a Linear project name and a repository's
 * configured name / GitHub / GitLab URL slug.
 *
 * Linear has no structured "linked GitHub repository" field on a Project —
 * only free-text description/summary fields. So instead of requiring every
 * repository to have `projectKeys` manually configured with the exact
 * Linear project name, `findRepositoryByProject` in RepositoryRouter falls
 * back to this fuzzy match once the exact-match pass fails (or when a repo
 * has no `projectKeys` configured at all).
 *
 * The match is intentionally conservative: it only returns a repo when the
 * best score clears a minimum confidence threshold AND is unambiguously
 * better than the runner-up. When two repos are near-equally plausible
 * matches (or nothing scores high enough), it returns null so routing falls
 * through to the next priority / the existing `needs_selection` UX rather
 * than silently guessing wrong.
 */

/** Minimum score (0-1) for a candidate to be considered a match at all. */
export const FUZZY_MATCH_MIN_SCORE = 0.5;

/** Minimum lead the best match must have over the runner-up to be unambiguous. */
export const FUZZY_MATCH_MIN_MARGIN = 0.15;

function normalizeForMatch(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 1);
}

/** Candidate strings to score a project name against for a given repo. */
function repoMatchCandidates(repo: RepositoryConfig): string[] {
	const candidates = [repo.name];
	for (const url of [repo.githubUrl, repo.gitlabUrl]) {
		if (!url) continue;
		const slug = url
			.split("/")
			.pop()
			?.replace(/\.git$/, "");
		if (slug) candidates.push(slug);
	}
	return candidates;
}

/**
 * Score two strings 0-1: 1.0 for an exact match once both are lowercased
 * and stripped of non-alphanumeric characters, otherwise the Jaccard
 * (intersection-over-union) overlap of their tokens.
 */
function scoreAgainst(projectName: string, candidate: string): number {
	if (normalizeForMatch(projectName) === normalizeForMatch(candidate)) {
		return 1;
	}
	const projectTokens = tokenize(projectName);
	const candidateTokens = tokenize(candidate);
	if (projectTokens.length === 0 || candidateTokens.length === 0) return 0;

	const overlap = projectTokens.filter((token) =>
		candidateTokens.includes(token),
	).length;
	const union = new Set([...projectTokens, ...candidateTokens]).size;
	return union === 0 ? 0 : overlap / union;
}

/**
 * Find the single best repository match for a Linear project name among
 * `repos`, or null if no candidate is a confident, unambiguous match.
 */
export function findBestFuzzyRepoMatch(
	projectName: string,
	repos: RepositoryConfig[],
): RepositoryConfig | null {
	if (repos.length === 0) return null;

	const scored = repos
		.map((repo) => ({
			repo,
			score: Math.max(
				...repoMatchCandidates(repo).map((candidate) =>
					scoreAgainst(projectName, candidate),
				),
			),
		}))
		.sort((a, b) => b.score - a.score);

	const best = scored[0];
	if (!best || best.score < FUZZY_MATCH_MIN_SCORE) return null;

	const second = scored[1];
	if (second && best.score - second.score < FUZZY_MATCH_MIN_MARGIN) {
		// Two (or more) repos are near-equally plausible matches — don't guess.
		return null;
	}

	return best.repo;
}
