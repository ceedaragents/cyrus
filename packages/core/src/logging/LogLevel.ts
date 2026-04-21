import { SeverityNumber } from "@opentelemetry/api-logs";

/**
 * Severity level as a value object.
 *
 * Constructed via the static singletons (DEBUG/INFO/WARN/ERROR/SILENT) —
 * there is a fixed set and no instances are created elsewhere. Ordering is
 * defined by ordinal(), which increases with severity so callers can compare
 * two levels directly via `compare`.
 */
export class LogLevel {
	static readonly DEBUG = new LogLevel("DEBUG", 0, SeverityNumber.DEBUG);
	static readonly INFO = new LogLevel("INFO", 1, SeverityNumber.INFO);
	static readonly WARN = new LogLevel("WARN", 2, SeverityNumber.WARN);
	static readonly ERROR = new LogLevel("ERROR", 3, SeverityNumber.ERROR);
	static readonly SILENT = new LogLevel(
		"SILENT",
		4,
		SeverityNumber.UNSPECIFIED,
	);

	private static readonly BY_NAME: Record<string, LogLevel> = {
		DEBUG: LogLevel.DEBUG,
		INFO: LogLevel.INFO,
		WARN: LogLevel.WARN,
		ERROR: LogLevel.ERROR,
		SILENT: LogLevel.SILENT,
	};

	private constructor(
		readonly name: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SILENT",
		private readonly _ordinal: number,
		private readonly otelSeverity: SeverityNumber,
	) {}

	/** Numeric ordinal, lower = less severe. */
	ordinal(): number {
		return this._ordinal;
	}

	/**
	 * Return negative if `this` is less severe than `other`, zero if equal,
	 * positive if more severe.
	 */
	compare(other: LogLevel): number {
		return this._ordinal - other._ordinal;
	}

	/** Map to OpenTelemetry SeverityNumber. */
	toOtelSeverity(): SeverityNumber {
		return this.otelSeverity;
	}

	/** Human-readable text mapping (OTel SeverityText field). */
	toOtelSeverityText(): string {
		return this.name === "SILENT" ? "UNSPECIFIED" : this.name;
	}

	toString(): string {
		return this.name;
	}

	/**
	 * Parse a case-insensitive level name into the corresponding singleton.
	 * Returns `undefined` for unknown names so callers can decide how to
	 * react (fall back to default, throw, etc.).
	 */
	static parse(value: string | undefined): LogLevel | undefined {
		if (!value) return undefined;
		return LogLevel.BY_NAME[value.toUpperCase()];
	}
}
