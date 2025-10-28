/**
 * ProcedureRouter - Intelligent routing of agent sessions through procedures
 *
 * Uses SimpleClaudeRunner to analyze requests and determine which procedure
 * (sequence of subroutines) should be executed.
 */

import type { CyrusAgentSession } from "cyrus-core";
import { SimpleClaudeRunner } from "cyrus-simple-agent-runner";
import { getProcedureForClassification, PROCEDURES } from "./registry.js";
import type {
	ProcedureDefinition,
	ProcedureMetadata,
	RequestClassification,
	RoutingDecision,
	SubroutineDefinition,
} from "./types.js";

export interface ProcedureRouterConfig {
	cyrusHome: string;
	model?: string;
	timeoutMs?: number;
}

export class ProcedureRouter {
	private routingRunner: SimpleClaudeRunner<RequestClassification>;
	private procedures: Map<string, ProcedureDefinition> = new Map();

	constructor(config: ProcedureRouterConfig) {
		// Initialize SimpleClaudeRunner for routing decisions
		this.routingRunner = new SimpleClaudeRunner({
			validResponses: [
				"question",
				"documentation",
				"transient",
				"planning",
				"code",
				"debugger",
				"orchestrator",
			],
			cyrusHome: config.cyrusHome,
			model: config.model || "haiku",
			fallbackModel: "sonnet",
			systemPrompt: this.buildRoutingSystemPrompt(),
			maxTurns: 1,
			timeoutMs: config.timeoutMs || 10000,
		});

		// Load all predefined procedures from registry
		this.loadPredefinedProcedures();
	}

	/**
	 * Build the system prompt for routing classification
	 */
	private buildRoutingSystemPrompt(): string {
		return `You are a request classifier for a software agent system.

Analyze the Linear issue request and classify it into ONE of these categories:

**question**: User is asking a question, seeking information, or requesting explanation.
- Examples: "How does X work?", "What is the purpose of Y?", "Explain the architecture"

**documentation**: User wants documentation, markdown, or comments edited (no code changes).
- Examples: "Update the README", "Add docstrings to functions", "Fix typos in docs"

**transient**: Request involves MCP tools, temporary files, or no codebase interaction.
- Examples: "Search the web for X", "Generate a diagram", "Use Linear MCP to check issues"

**planning**: Request has vague requirements, needs clarification, or asks for an implementation plan.
- Examples: "Can you help with the authentication system?", "I need to improve performance", "Add a new feature for user management"
- Use when requirements are unclear, missing details, or user asks for a plan/proposal
- DO NOT use if the request has clear, specific requirements (use "code" instead)
- DO NOT use for adding/writing tests, fixing tests, or other test-related work (use "code" instead)

**debugger**: User EXPLICITLY requests the full debugging workflow with reproduction and approval.
- ONLY use this if the user specifically asks for: "debug this with approval workflow", "reproduce the bug first", "show me the root cause before fixing"
- DO NOT use for regular bug reports - those should use "code"
- Examples: "Debug this issue and get my approval before fixing", "Reproduce the authentication bug with approval checkpoint"

**orchestrator**: User EXPLICITLY requests decomposition into sub-issues with specialized agent delegation.
- ONLY use this if the user specifically asks for: "break this into sub-issues", "orchestrate this work", "use sub-agents", "delegate to specialized agents"
- DO NOT use for regular complex work - those should use "code"
- Examples: "Orchestrate this feature with sub-issues", "Break this down and delegate to specialized agents", "Create sub-tasks for this epic"

**code**: Request involves code changes with clear, specific requirements (DEFAULT for most work).
- Examples: "Fix bug in X", "Add feature Y", "Refactor module Z", "Implement new API endpoint", "Fix the login issue"
- Use this for ALL standard bug fixes and features with clear requirements
- Use this for ALL test-related work: "Add unit tests", "Fix failing tests", "Write test coverage", etc.
- Use this when user explicitly says "Classify as full development", "classify as code", or similar

IMPORTANT: Respond with ONLY the classification word, nothing else.`;
	}

	/**
	 * Load predefined procedures from registry
	 */
	private loadPredefinedProcedures(): void {
		for (const [name, procedure] of Object.entries(PROCEDURES)) {
			this.procedures.set(name, procedure);
		}
	}

	/**
	 * Determine which procedure to use for a given request
	 */
	async determineRoutine(requestText: string): Promise<RoutingDecision> {
		try {
			// Classify the request using SimpleClaudeRunner
			const result = await this.routingRunner.query(
				`Classify this Linear issue request:\n\n${requestText}`,
			);

			const classification = result.response;

			// Get procedure name for this classification
			const procedureName = getProcedureForClassification(classification);

			// Get procedure definition
			const procedure = this.procedures.get(procedureName);

			if (!procedure) {
				throw new Error(`Procedure "${procedureName}" not found in registry`);
			}

			return {
				classification,
				procedure,
				reasoning: `Classified as "${classification}" → using procedure "${procedureName}"`,
			};
		} catch (error) {
			// Fallback to full-development on error
			console.error("[ProcedureRouter] Error during routing decision:", error);
			const fallbackProcedure = this.procedures.get("full-development");

			if (!fallbackProcedure) {
				throw new Error("Fallback procedure 'full-development' not found");
			}

			return {
				classification: "code",
				procedure: fallbackProcedure,
				reasoning: `Fallback to full-development due to error: ${error}`,
			};
		}
	}

	/**
	 * Get the next subroutine for a session
	 * Returns null if procedure is complete
	 */
	getNextSubroutine(session: CyrusAgentSession): SubroutineDefinition | null {
		const procedureMetadata = session.metadata?.procedure as
			| ProcedureMetadata
			| undefined;

		if (!procedureMetadata) {
			// No procedure metadata - session doesn't use procedure routing
			return null;
		}

		const procedure = this.procedures.get(procedureMetadata.procedureName);

		if (!procedure) {
			console.error(
				`[ProcedureRouter] Procedure "${procedureMetadata.procedureName}" not found`,
			);
			return null;
		}

		const nextIndex = procedureMetadata.currentSubroutineIndex + 1;

		if (nextIndex >= procedure.subroutines.length) {
			// Procedure complete
			return null;
		}

		return procedure.subroutines[nextIndex] ?? null;
	}

	/**
	 * Get the current subroutine for a session
	 */
	getCurrentSubroutine(
		session: CyrusAgentSession,
	): SubroutineDefinition | null {
		const procedureMetadata = session.metadata?.procedure as
			| ProcedureMetadata
			| undefined;

		if (!procedureMetadata) {
			return null;
		}

		const procedure = this.procedures.get(procedureMetadata.procedureName);

		if (!procedure) {
			return null;
		}

		const currentIndex = procedureMetadata.currentSubroutineIndex;

		if (currentIndex < 0 || currentIndex >= procedure.subroutines.length) {
			return null;
		}

		return procedure.subroutines[currentIndex] ?? null;
	}

	/**
	 * Initialize procedure metadata for a new session
	 */
	initializeProcedureMetadata(
		session: CyrusAgentSession,
		procedure: ProcedureDefinition,
	): void {
		if (!session.metadata) {
			session.metadata = {};
		}

		session.metadata.procedure = {
			procedureName: procedure.name,
			currentSubroutineIndex: 0,
			subroutineHistory: [],
		} satisfies ProcedureMetadata;
	}

	/**
	 * Record subroutine completion and advance to next
	 */
	advanceToNextSubroutine(
		session: CyrusAgentSession,
		claudeSessionId: string | null,
	): void {
		const procedureMetadata = session.metadata?.procedure as
			| ProcedureMetadata
			| undefined;

		if (!procedureMetadata) {
			throw new Error("Cannot advance: session has no procedure metadata");
		}

		const currentSubroutine = this.getCurrentSubroutine(session);

		if (currentSubroutine) {
			// Record completion
			procedureMetadata.subroutineHistory.push({
				subroutine: currentSubroutine.name,
				completedAt: Date.now(),
				claudeSessionId,
			});
		}

		// Advance index
		procedureMetadata.currentSubroutineIndex++;
	}

	/**
	 * Check if procedure is complete
	 */
	isProcedureComplete(session: CyrusAgentSession): boolean {
		return this.getNextSubroutine(session) === null;
	}

	/**
	 * Register a custom procedure
	 */
	registerProcedure(procedure: ProcedureDefinition): void {
		this.procedures.set(procedure.name, procedure);
	}

	/**
	 * Get procedure by name
	 */
	getProcedure(name: string): ProcedureDefinition | undefined {
		return this.procedures.get(name);
	}
}
