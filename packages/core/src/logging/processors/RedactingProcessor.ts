import type { LogPipeline, LogProcessor } from "../LogPipeline.js";
import type { LogRecord } from "../LogRecord.js";
import type { RedactionPolicy } from "../redaction/RedactionPolicy.js";

/**
 * Applies a redaction policy to every record before forwarding.
 *
 * Pure decorator: the policy is injected so tests and deployments can
 * substitute stricter or permissive rules without touching sink code.
 */
export class RedactingProcessor implements LogProcessor {
	constructor(
		readonly next: LogPipeline,
		private readonly policy: RedactionPolicy,
	) {}

	write(record: LogRecord): void {
		this.next.write(this.policy.apply(record));
	}

	shutdown(signal: AbortSignal): Promise<void> {
		return this.next.shutdown(signal);
	}
}
