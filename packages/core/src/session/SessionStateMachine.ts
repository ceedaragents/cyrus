import { AgentSessionStatus } from "@linear/sdk";
import { CyrusSessionStatus } from "./CyrusSessionStatus.js";

/**
 * Events that trigger state transitions
 */
export enum SessionEvent {
	/** Session initialization started (runner being created) */
	InitializeRunner = "initializeRunner",

	/** Runner has initialized and is ready */
	RunnerInitialized = "runnerInitialized",

	/** Message received and being processed */
	MessageReceived = "messageReceived",

	/** Result message received from runner */
	ResultReceived = "resultReceived",

	/** Cleanup after result has completed */
	CleanupComplete = "cleanupComplete",

	/** Stop signal received (from Linear or user) */
	StopSignal = "stopSignal",

	/** Runner has confirmed it stopped */
	RunnerStopped = "runnerStopped",

	/** An error occurred */
	Error = "error",

	/** Resume a stopped session */
	Resume = "resume",
}

/**
 * Defines valid state transitions
 * Key: current state
 * Value: Map of event -> next state
 */
const STATE_TRANSITIONS: Record<
	CyrusSessionStatus,
	Partial<Record<SessionEvent, CyrusSessionStatus>>
> = {
	[CyrusSessionStatus.Created]: {
		[SessionEvent.InitializeRunner]: CyrusSessionStatus.Starting,
		[SessionEvent.Error]: CyrusSessionStatus.Failed,
	},

	[CyrusSessionStatus.Starting]: {
		[SessionEvent.RunnerInitialized]: CyrusSessionStatus.Running,
		[SessionEvent.Error]: CyrusSessionStatus.Failed,
		[SessionEvent.StopSignal]: CyrusSessionStatus.Stopping,
	},

	[CyrusSessionStatus.Running]: {
		[SessionEvent.MessageReceived]: CyrusSessionStatus.Running,
		[SessionEvent.ResultReceived]: CyrusSessionStatus.Completing,
		[SessionEvent.StopSignal]: CyrusSessionStatus.Stopping,
		[SessionEvent.Error]: CyrusSessionStatus.Failed,
	},

	[CyrusSessionStatus.Completing]: {
		[SessionEvent.CleanupComplete]: CyrusSessionStatus.Completed,
		[SessionEvent.Error]: CyrusSessionStatus.Failed,
	},

	[CyrusSessionStatus.Stopping]: {
		[SessionEvent.RunnerStopped]: CyrusSessionStatus.Stopped,
		[SessionEvent.Error]: CyrusSessionStatus.Failed,
	},

	[CyrusSessionStatus.Stopped]: {
		[SessionEvent.Resume]: CyrusSessionStatus.Starting,
		// Stopped is a semi-terminal state - can be cleaned up but also resumed
	},

	[CyrusSessionStatus.Completed]: {
		[SessionEvent.Resume]: CyrusSessionStatus.Starting,
		// Completed sessions can be resumed for follow-up conversations
	},

	[CyrusSessionStatus.Failed]: {
		[SessionEvent.Resume]: CyrusSessionStatus.Starting,
		// Failed sessions can be resumed to retry
	},
};

/**
 * Maps internal CyrusSessionStatus to Linear's AgentSessionStatus
 * for API interactions
 */
export function toLinearStatus(status: CyrusSessionStatus): AgentSessionStatus {
	switch (status) {
		case CyrusSessionStatus.Created:
			return AgentSessionStatus.Pending;

		case CyrusSessionStatus.Starting:
		case CyrusSessionStatus.Running:
			return AgentSessionStatus.Active;

		case CyrusSessionStatus.Stopping:
		case CyrusSessionStatus.Completing:
			return AgentSessionStatus.Active;

		case CyrusSessionStatus.Stopped:
			// Stopped sessions are "stale" from Linear's perspective
			// They can be resumed but are not actively processing
			return AgentSessionStatus.Stale;

		case CyrusSessionStatus.Completed:
			return AgentSessionStatus.Complete;

		case CyrusSessionStatus.Failed:
			return AgentSessionStatus.Error;

		default:
			// Fallback for any unexpected status
			return AgentSessionStatus.Error;
	}
}

/**
 * Error thrown when an invalid state transition is attempted
 */
export class InvalidTransitionError extends Error {
	constructor(
		public readonly currentState: CyrusSessionStatus,
		public readonly event: SessionEvent,
		public readonly sessionId?: string,
	) {
		const sessionInfo = sessionId ? ` for session ${sessionId}` : "";
		super(
			`Invalid state transition${sessionInfo}: Cannot transition from "${currentState}" with event "${event}"`,
		);
		this.name = "InvalidTransitionError";
	}
}

/**
 * Transition result with metadata
 */
export interface TransitionResult {
	/** Whether the transition was successful */
	success: boolean;
	/** The previous state */
	previousState: CyrusSessionStatus;
	/** The new state (same as previous if transition failed) */
	newState: CyrusSessionStatus;
	/** The event that triggered the transition */
	event: SessionEvent;
	/** Timestamp of the transition */
	timestamp: number;
}

/**
 * Session state machine for managing agent session lifecycle
 *
 * Provides:
 * - Explicit state transition validation
 * - Prevention of invalid state changes
 * - Transition logging for debugging
 * - Mapping to Linear's AgentSessionStatus for API interactions
 */
export class SessionStateMachine {
	private currentState: CyrusSessionStatus;
	private readonly sessionId: string;
	private transitionHistory: TransitionResult[] = [];

	constructor(
		sessionId: string,
		initialState: CyrusSessionStatus = CyrusSessionStatus.Created,
	) {
		this.sessionId = sessionId;
		this.currentState = initialState;
	}

	/**
	 * Get the current internal status
	 */
	getStatus(): CyrusSessionStatus {
		return this.currentState;
	}

	/**
	 * Get the current status mapped to Linear's AgentSessionStatus
	 */
	getLinearStatus(): AgentSessionStatus {
		return toLinearStatus(this.currentState);
	}

	/**
	 * Get the session ID
	 */
	getSessionId(): string {
		return this.sessionId;
	}

	/**
	 * Get transition history for debugging
	 */
	getTransitionHistory(): readonly TransitionResult[] {
		return this.transitionHistory;
	}

	/**
	 * Check if a transition is valid without performing it
	 */
	canTransition(event: SessionEvent): boolean {
		const transitions = STATE_TRANSITIONS[this.currentState];
		return transitions !== undefined && event in transitions;
	}

	/**
	 * Get the next state for an event without performing the transition
	 * Returns undefined if the transition is not valid
	 */
	getNextState(event: SessionEvent): CyrusSessionStatus | undefined {
		const transitions = STATE_TRANSITIONS[this.currentState];
		if (!transitions) return undefined;
		return transitions[event];
	}

	/**
	 * Perform a state transition
	 *
	 * @param event - The event triggering the transition
	 * @param throwOnInvalid - If true, throws InvalidTransitionError on invalid transitions
	 * @returns TransitionResult with success status and state information
	 */
	transition(event: SessionEvent, throwOnInvalid = false): TransitionResult {
		const previousState = this.currentState;
		const nextState = this.getNextState(event);

		if (nextState === undefined) {
			if (throwOnInvalid) {
				throw new InvalidTransitionError(
					this.currentState,
					event,
					this.sessionId,
				);
			}

			// Return failed transition result
			const result: TransitionResult = {
				success: false,
				previousState,
				newState: previousState,
				event,
				timestamp: Date.now(),
			};

			console.warn(
				`[SessionStateMachine] Invalid transition for session ${this.sessionId}: ${previousState} + ${event} -> (blocked)`,
			);

			return result;
		}

		// Perform the transition
		this.currentState = nextState;

		const result: TransitionResult = {
			success: true,
			previousState,
			newState: nextState,
			event,
			timestamp: Date.now(),
		};

		this.transitionHistory.push(result);

		// Log the transition for debugging
		if (previousState !== nextState) {
			console.log(
				`[SessionStateMachine] Session ${this.sessionId}: ${previousState} -> ${nextState} (${event})`,
			);
		}

		return result;
	}

	/**
	 * Force set the state (use sparingly, mainly for state restoration)
	 * This bypasses transition validation
	 */
	forceSetState(state: CyrusSessionStatus): void {
		const previousState = this.currentState;
		this.currentState = state;

		console.warn(
			`[SessionStateMachine] Force set session ${this.sessionId}: ${previousState} -> ${state}`,
		);

		this.transitionHistory.push({
			success: true,
			previousState,
			newState: state,
			event: SessionEvent.Error, // Use Error as a placeholder for force-set
			timestamp: Date.now(),
		});
	}

	/**
	 * Check if the session is in a terminal state
	 */
	isTerminal(): boolean {
		return (
			this.currentState === CyrusSessionStatus.Completed ||
			this.currentState === CyrusSessionStatus.Failed
		);
	}

	/**
	 * Check if the session is actively processing
	 */
	isActive(): boolean {
		return (
			this.currentState === CyrusSessionStatus.Starting ||
			this.currentState === CyrusSessionStatus.Running ||
			this.currentState === CyrusSessionStatus.Completing
		);
	}

	/**
	 * Check if the session can be resumed
	 */
	canResume(): boolean {
		return this.currentState === CyrusSessionStatus.Stopped;
	}

	/**
	 * Serialize state machine for persistence
	 */
	serialize(): { sessionId: string; status: CyrusSessionStatus } {
		return {
			sessionId: this.sessionId,
			status: this.currentState,
		};
	}

	/**
	 * Create a state machine from serialized data
	 */
	static deserialize(data: {
		sessionId: string;
		status: CyrusSessionStatus;
	}): SessionStateMachine {
		return new SessionStateMachine(data.sessionId, data.status);
	}
}
