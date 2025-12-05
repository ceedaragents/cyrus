/**
 * Internal Cyrus session status enum
 *
 * Provides finer-grained status tracking than Linear's AgentSessionStatus.
 * This enum is used internally by Cyrus for state machine transitions,
 * while Linear's AgentSessionStatus is used for API interactions.
 *
 * State Diagram:
 * ```
 * [*] --> Created: webhook received
 *
 * Created --> Starting: initializeRunner()
 * Starting --> Running: runner.onInit
 * Running --> Running: addStreamMessage()
 * Running --> Completing: result message received
 * Completing --> Completed: cleanup done
 * Running --> Stopping: stop signal
 * Stopping --> Stopped: runner confirmed stopped
 * Running --> Failed: error caught
 *
 * Stopped --> Starting: resume (new prompt)
 *
 * Completed --> [*]
 * Failed --> [*]
 * Stopped --> [*]: session cleanup
 * ```
 */
export enum CyrusSessionStatus {
	/** Session exists, no runner yet (webhook received, session created) */
	Created = "created",

	/** Runner is being initialized */
	Starting = "starting",

	/** Actively processing messages */
	Running = "running",

	/** Stop signal received, waiting for cleanup */
	Stopping = "stopping",

	/** Gracefully stopped, can resume with new prompt */
	Stopped = "stopped",

	/** Result received, finalizing (cleanup in progress) */
	Completing = "completing",

	/** Successfully finished all work */
	Completed = "completed",

	/** Error state - unrecoverable failure */
	Failed = "failed",
}

/**
 * Check if a status is terminal (no further transitions expected)
 */
export function isTerminalStatus(status: CyrusSessionStatus): boolean {
	return (
		status === CyrusSessionStatus.Completed ||
		status === CyrusSessionStatus.Failed
	);
}

/**
 * Check if a status indicates the session is actively processing
 */
export function isActiveStatus(status: CyrusSessionStatus): boolean {
	return (
		status === CyrusSessionStatus.Starting ||
		status === CyrusSessionStatus.Running ||
		status === CyrusSessionStatus.Completing
	);
}

/**
 * Check if a session can be resumed from this status
 */
export function canResume(status: CyrusSessionStatus): boolean {
	return status === CyrusSessionStatus.Stopped;
}
