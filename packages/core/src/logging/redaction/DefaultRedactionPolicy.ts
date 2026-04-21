import type { CyrusEvent } from "../events.js";
import type { LogRecord } from "../LogRecord.js";
import type { RedactionPolicy } from "./RedactionPolicy.js";

const DEFAULT_SENSITIVE_KEY_PATTERN =
	/token|secret|password|bearer|credential|apikey|api[._-]?key|authorization|auth[._-]?header|cookie|session[._-]?cookie|private[._-]?key|client[._-]?secret/i;

const REDACTED_PLACEHOLDER = "[REDACTED]";
const MAX_REDACTION_DEPTH = 6;

export interface DefaultRedactionPolicyOptions {
	/** Override the sensitive-key regex. Default matches common token/secret names. */
	pattern?: RegExp;
	/** Placeholder string substituted for redacted values. */
	placeholder?: string;
	/** Maximum recursion depth; deeper values pass through untouched. */
	maxDepth?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Walks plain objects and arrays, replacing the values of keys that match
 * the configured sensitive pattern. Other container shapes (Map, Set, class
 * instances) are flattened by `JSON.stringify` before recursion, so the walk
 * sees the same plain tree that the OTel exporter will ultimately serialise.
 *
 * Depth-limited to guard against pathological cyclic-but-serialisable graphs
 * that slip past `JSON.stringify`'s cycle detection via `toJSON` tricks.
 */
export class DefaultRedactionPolicy implements RedactionPolicy {
	private readonly pattern: RegExp;
	private readonly placeholder: string;
	private readonly maxDepth: number;

	constructor(options: DefaultRedactionPolicyOptions = {}) {
		this.pattern = options.pattern ?? DEFAULT_SENSITIVE_KEY_PATTERN;
		this.placeholder = options.placeholder ?? REDACTED_PLACEHOLDER;
		this.maxDepth = options.maxDepth ?? MAX_REDACTION_DEPTH;
	}

	apply(record: LogRecord): LogRecord {
		if (record.kind === "log") {
			if (record.args.length === 0) return record;
			const redactedArgs = record.args.map((arg) => this.redactArg(arg));
			return { ...record, args: redactedArgs };
		}
		return { ...record, event: this.redactEvent(record.event) };
	}

	private redactArg(arg: unknown): unknown {
		if (arg === null || arg === undefined) return arg;
		if (
			typeof arg === "string" ||
			typeof arg === "number" ||
			typeof arg === "boolean"
		) {
			return arg;
		}
		if (arg instanceof Error) {
			return {
				name: arg.name,
				message: arg.message,
				stack: arg.stack,
			};
		}
		let plain: unknown;
		try {
			plain = JSON.parse(JSON.stringify(arg));
		} catch {
			return String(arg);
		}
		return this.redactRecursive(plain, 0);
	}

	private redactEvent(event: CyrusEvent): CyrusEvent {
		const redacted = this.redactRecursive(
			{ ...event } as Record<string, unknown>,
			0,
		);
		return redacted as CyrusEvent;
	}

	private redactRecursive(value: unknown, depth: number): unknown {
		if (depth > this.maxDepth) {
			return value;
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.redactRecursive(item, depth + 1));
		}
		if (isPlainObject(value)) {
			const out: Record<string, unknown> = {};
			for (const [key, v] of Object.entries(value)) {
				if (this.pattern.test(key)) {
					out[key] = this.placeholder;
				} else {
					out[key] = this.redactRecursive(v, depth + 1);
				}
			}
			return out;
		}
		return value;
	}
}
