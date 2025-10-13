export function toError(
	value: unknown,
	fallbackMessage = "Unknown error",
): Error {
	if (value instanceof Error) {
		return value;
	}

	if (typeof value === "string") {
		return new Error(value);
	}

	if (value && typeof value === "object") {
		try {
			return new Error(JSON.stringify(value));
		} catch (_error) {
			return new Error(fallbackMessage);
		}
	}

	return new Error(fallbackMessage);
}
