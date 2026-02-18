/**
 * Extracts a concise title (max 80 chars) from a plain-text Telegram message.
 * Uses the first sentence or first 80 characters, whichever is shorter.
 */
export function extractTitle(message: string): string {
	const trimmed = message.trim();
	if (trimmed.length === 0) {
		return "Untitled";
	}

	// Take first sentence (ending with . ! or ?)
	const sentenceMatch = trimmed.match(/^(.+?[.!?])\s/);
	const firstCapture = sentenceMatch?.[1];
	if (firstCapture && firstCapture.length <= 80) {
		return firstCapture;
	}

	// Take first line
	const firstLine = trimmed.split("\n")[0] ?? trimmed;
	if (firstLine.length <= 80) {
		return firstLine;
	}

	// Truncate at word boundary
	const truncated = firstLine.slice(0, 77);
	const lastSpace = truncated.lastIndexOf(" ");
	return `${truncated.slice(0, lastSpace > 40 ? lastSpace : 77)}...`;
}
