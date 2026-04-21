import type { LogPipeline } from "./LogPipeline.js";
import type { LogRecord } from "./LogRecord.js";

/**
 * Broadcasts records to a fixed list of downstream pipelines.
 *
 * Sink failures are isolated: a thrown error in one branch is swallowed
 * (after being forwarded to stderr for debuggability) so the remaining
 * branches still see the record. This is the right default for a logging
 * pipeline — losing all sinks because one collector is misbehaving would be
 * strictly worse than losing that one branch.
 *
 * On shutdown the fan-out races all branches to completion under the shared
 * `AbortSignal` deadline, so a single unresponsive branch cannot block
 * process exit.
 */
export class FanOutPipeline implements LogPipeline {
	constructor(private readonly branches: readonly LogPipeline[]) {}

	write(record: LogRecord): void {
		for (const branch of this.branches) {
			try {
				branch.write(record);
			} catch (error) {
				// Deliberately write to the raw stderr stream — routing the error
				// through the pipeline would risk re-entering the failing branch.
				process.stderr.write(
					`[logging] sink threw: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}
	}

	async shutdown(signal: AbortSignal): Promise<void> {
		await Promise.all(
			this.branches.map((branch) =>
				branch.shutdown(signal).catch((error) => {
					process.stderr.write(
						`[logging] sink shutdown threw: ${error instanceof Error ? error.message : String(error)}\n`,
					);
				}),
			),
		);
	}
}
