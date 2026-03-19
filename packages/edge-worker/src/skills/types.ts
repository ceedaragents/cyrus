/**
 * Type definitions for the skill-based workflow system.
 *
 * Skills replace the rigid subroutine sequences with a single-session approach
 * where all workflow guidance is loaded into the system prompt upfront.
 */

import type { RequestClassification } from "../procedures/types.js";

/**
 * A skill definition loaded from a markdown file.
 */
export interface SkillDefinition {
	/** Unique identifier (derived from filename, e.g., "verify-and-ship") */
	name: string;

	/** Human-readable description */
	description: string;

	/** The markdown content of the skill */
	content: string;

	/** Where this skill was loaded from */
	source: "default" | "repository" | "global";
}

/**
 * A workflow template that maps a classification to a set of skills
 * and provides ordering guidance.
 */
export interface WorkflowTemplate {
	/** Unique name for the workflow (e.g., "full-development") */
	name: string;

	/** Human-readable description */
	description: string;

	/** Ordered list of skill names to include */
	skills: string[];

	/** Numbered checklist guidance for the agent */
	workflowGuidance: string;

	/** Whether this workflow involves code changes (used to decide if Stop hook is needed) */
	involvesCodeChanges: boolean;
}

/**
 * Result of workflow determination (analogous to ProcedureAnalysisDecision).
 */
export interface WorkflowDecision {
	/** Classification of the request */
	classification: RequestClassification;

	/** Selected workflow template */
	workflow: WorkflowTemplate;

	/** Reasoning for the classification */
	reasoning?: string;
}

/**
 * Workflow metadata stored in session.metadata.workflow
 */
export interface WorkflowMetadata {
	/** The classification that was determined */
	classification: string;

	/** Names of skills included in the session */
	skills: string[];

	/** Name of the workflow template used */
	workflowName: string;
}
