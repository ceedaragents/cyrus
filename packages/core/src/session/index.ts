/**
 * Session state management module
 *
 * Provides:
 * - CyrusSessionStatus enum for fine-grained internal status tracking
 * - SessionStateMachine for validated state transitions
 * - Mapping utilities between internal and Linear statuses
 */

export {
	CyrusSessionStatus,
	canResume,
	isActiveStatus,
	isTerminalStatus,
} from "./CyrusSessionStatus.js";

export {
	InvalidTransitionError,
	SessionEvent,
	SessionStateMachine,
	type TransitionResult,
	toLinearStatus,
} from "./SessionStateMachine.js";
