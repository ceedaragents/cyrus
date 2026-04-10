/**
 * Centralized secret redaction for all outbound messages.
 *
 * Scrubs known secret values and common token patterns from arbitrary text
 * before it reaches any external service (Linear, Slack, GitHub, GitLab).
 */

import type { AgentActivityContent } from "cyrus-core";

/** Replacement string used for redacted values. */
const REDACTED = "[REDACTED]";

/** Minimum length for a secret value to be registered (avoids false positives on short strings). */
const MIN_SECRET_LENGTH = 8;

/**
 * Interface for secret redaction. Consumers depend on this abstraction,
 * not the concrete SecretRedactor class.
 */
export interface ISecretRedactor {
	/** Scrub all known secrets and token patterns from the given text. */
	redact(text: string): string;

	/** Register additional secret values to be redacted. */
	addSecrets(values: string[]): void;
}

/**
 * Well-known token prefixes that should be caught even if not explicitly registered.
 *
 * Each pattern matches the prefix and a reasonable suffix length to avoid
 * false positives while still catching tokens that weren't registered.
 */
const TOKEN_PATTERNS: RegExp[] = [
	// Anthropic API keys
	/sk-ant-[\w-]{20,}/g,
	// OpenAI API keys (project-scoped and legacy)
	/sk-proj-[\w-]{20,}/g,
	/sk-[\w]{20,}/g,
	// Slack bot tokens
	/xoxb-[\w-]{20,}/g,
	// Slack user tokens
	/xoxp-[\w-]{20,}/g,
	// Slack app-level tokens
	/xapp-[\w-]{20,}/g,
	// GitHub personal access tokens (classic and fine-grained)
	/ghp_[A-Za-z0-9]{36,}/g,
	// GitHub server-to-server tokens
	/ghs_[A-Za-z0-9]{36,}/g,
	// GitHub user-to-server tokens
	/ghu_[A-Za-z0-9]{36,}/g,
	// GitHub OAuth access tokens
	/gho_[A-Za-z0-9]{36,}/g,
	// GitHub App refresh tokens
	/ghr_[A-Za-z0-9]{36,}/g,
	// GitLab personal/project/group access tokens
	/glpat-[\w-]{20,}/g,
	// Google API keys
	/AIza[A-Za-z0-9_-]{35}/g,
	// AWS access key IDs
	/AKIA[A-Z0-9]{16}/g,
	// Generic Bearer tokens in markdown/text (catches leaked auth headers)
	/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
];

export class SecretRedactor implements ISecretRedactor {
	private readonly secrets: Set<string> = new Set();

	/**
	 * Register secret values to redact.
	 * Values shorter than MIN_SECRET_LENGTH are ignored to avoid false positives.
	 */
	addSecrets(values: string[]): void {
		for (const value of values) {
			const trimmed = value.trim();
			if (trimmed.length >= MIN_SECRET_LENGTH) {
				this.secrets.add(trimmed);
			}
		}
	}

	/**
	 * Scrub all registered secrets and well-known token patterns from text.
	 *
	 * Exact-value replacement runs first (longer values replaced first to avoid
	 * partial matches), then pattern-based replacement catches unregistered tokens.
	 */
	redact(text: string): string {
		if (!text) {
			return text;
		}

		let result = text;

		// Replace exact secret values, longest first to avoid partial replacements
		const sortedSecrets = [...this.secrets].sort((a, b) => b.length - a.length);
		for (const secret of sortedSecrets) {
			result = result.replaceAll(secret, REDACTED);
		}

		// Apply well-known token patterns
		for (const pattern of TOKEN_PATTERNS) {
			// Reset lastIndex since these are global regexes that may be reused
			pattern.lastIndex = 0;
			result = result.replace(pattern, REDACTED);
		}

		return result;
	}
}

/**
 * Deep-scrub all string fields of an AgentActivityContent object.
 *
 * Returns a shallow copy with redacted string values; the original is not mutated.
 */
export function redactActivityContent(
	redactor: ISecretRedactor,
	content: AgentActivityContent,
): AgentActivityContent {
	if ("body" in content && typeof content.body === "string") {
		return { ...content, body: redactor.redact(content.body) };
	}

	if ("action" in content) {
		return {
			...content,
			action: redactor.redact(content.action),
			parameter: redactor.redact(content.parameter),
			...(content.result != null && {
				result: redactor.redact(content.result),
			}),
		};
	}

	return content;
}
