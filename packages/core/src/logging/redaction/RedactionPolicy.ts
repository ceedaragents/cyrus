import type { LogRecord } from "../LogRecord.js";

/**
 * Policy for removing sensitive fields from a record before it is exported.
 *
 * Policies are pure — given the same input record they produce the same
 * output. Implementations must return a new record (or the same reference
 * when nothing needed to change) and must not mutate the input.
 */
export interface RedactionPolicy {
	apply(record: LogRecord): LogRecord;
}
