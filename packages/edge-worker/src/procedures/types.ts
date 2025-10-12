/**
 * Type definitions for the procedure routing system
 */

/**
 * Definition of a single subroutine in a procedure
 */
export interface SubroutineDefinition {
	/** Unique identifier for the subroutine */
	name: string;

	/** Path to the prompt file (relative to edge-worker/src/prompts/) */
	promptPath: string;

	/** Optional maximum number of turns (undefined = unlimited) */
	maxTurns?: number;

	/** Human-readable description of what this subroutine does */
	description: string;

	/** Whether this subroutine should skip posting to Linear activity stream */
	skipLinearPost?: boolean;

	/** Whether to suppress posting thoughts/actions (still posts final summary) */
	suppressThoughtPosting?: boolean;

	/** Whether this subroutine requires user approval before advancing to next step */
	requiresApproval?: boolean;
}

/**
 * Complete definition of a procedure (sequence of subroutines)
 */
export interface ProcedureDefinition {
	/** Unique identifier for the procedure */
	name: string;

	/** Human-readable description of when to use this procedure */
	description: string;

	/** Ordered list of subroutines to execute */
	subroutines: SubroutineDefinition[];
}

/**
 * Procedure metadata stored in session.metadata.procedure
 */
export interface ProcedureMetadata {
	/** Name of the active procedure */
	procedureName: string;

	/** Current position in the subroutine sequence (0-indexed) */
	currentSubroutineIndex: number;

	/** History of completed subroutines */
	subroutineHistory: Array<{
		subroutine: string;
		completedAt: number;
		claudeSessionId: string | null;
	}>;
}

/**
 * Request classification types for routing decisions
 */
export type RequestClassification =
	| "question"
	| "documentation"
	| "transient"
	| "code";

/**
 * Result of procedure routing decision
 */
export interface RoutingDecision {
	/** Classification of the request */
	classification: RequestClassification;

	/** Selected procedure to execute */
	procedure: ProcedureDefinition;

	/** Reasoning for the classification (for debugging) */
	reasoning?: string;
}
