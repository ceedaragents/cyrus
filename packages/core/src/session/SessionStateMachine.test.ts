import { AgentSessionStatus } from "@linear/sdk";
import { describe, expect, it } from "vitest";
import { CyrusSessionStatus } from "./CyrusSessionStatus.js";
import {
	InvalidTransitionError,
	SessionEvent,
	SessionStateMachine,
	toLinearStatus,
} from "./SessionStateMachine.js";

describe("CyrusSessionStatus", () => {
	it("should have all expected status values", () => {
		expect(CyrusSessionStatus.Created).toBe("created");
		expect(CyrusSessionStatus.Starting).toBe("starting");
		expect(CyrusSessionStatus.Running).toBe("running");
		expect(CyrusSessionStatus.Stopping).toBe("stopping");
		expect(CyrusSessionStatus.Stopped).toBe("stopped");
		expect(CyrusSessionStatus.Completing).toBe("completing");
		expect(CyrusSessionStatus.Completed).toBe("completed");
		expect(CyrusSessionStatus.Failed).toBe("failed");
	});
});

describe("SessionStateMachine", () => {
	describe("initialization", () => {
		it("should initialize with Created status by default", () => {
			const sm = new SessionStateMachine("test-session");
			expect(sm.getStatus()).toBe(CyrusSessionStatus.Created);
		});

		it("should initialize with custom status", () => {
			const sm = new SessionStateMachine(
				"test-session",
				CyrusSessionStatus.Running,
			);
			expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);
		});

		it("should return the session ID", () => {
			const sm = new SessionStateMachine("test-session-123");
			expect(sm.getSessionId()).toBe("test-session-123");
		});
	});

	describe("valid transitions", () => {
		it("should transition from Created to Starting on InitializeRunner", () => {
			const sm = new SessionStateMachine("test");
			const result = sm.transition(SessionEvent.InitializeRunner);

			expect(result.success).toBe(true);
			expect(result.previousState).toBe(CyrusSessionStatus.Created);
			expect(result.newState).toBe(CyrusSessionStatus.Starting);
			expect(sm.getStatus()).toBe(CyrusSessionStatus.Starting);
		});

		it("should transition from Starting to Running on RunnerInitialized", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Starting);
			const result = sm.transition(SessionEvent.RunnerInitialized);

			expect(result.success).toBe(true);
			expect(result.newState).toBe(CyrusSessionStatus.Running);
		});

		it("should stay in Running state on MessageReceived", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Running);
			const result = sm.transition(SessionEvent.MessageReceived);

			expect(result.success).toBe(true);
			expect(result.previousState).toBe(CyrusSessionStatus.Running);
			expect(result.newState).toBe(CyrusSessionStatus.Running);
		});

		it("should transition from Running to Completing on ResultReceived", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Running);
			const result = sm.transition(SessionEvent.ResultReceived);

			expect(result.success).toBe(true);
			expect(result.newState).toBe(CyrusSessionStatus.Completing);
		});

		it("should transition from Completing to Completed on CleanupComplete", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Completing);
			const result = sm.transition(SessionEvent.CleanupComplete);

			expect(result.success).toBe(true);
			expect(result.newState).toBe(CyrusSessionStatus.Completed);
		});

		it("should transition from Running to Stopping on StopSignal", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Running);
			const result = sm.transition(SessionEvent.StopSignal);

			expect(result.success).toBe(true);
			expect(result.newState).toBe(CyrusSessionStatus.Stopping);
		});

		it("should transition from Stopping to Stopped on RunnerStopped", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Stopping);
			const result = sm.transition(SessionEvent.RunnerStopped);

			expect(result.success).toBe(true);
			expect(result.newState).toBe(CyrusSessionStatus.Stopped);
		});

		it("should transition from Stopped to Starting on Resume", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Stopped);
			const result = sm.transition(SessionEvent.Resume);

			expect(result.success).toBe(true);
			expect(result.newState).toBe(CyrusSessionStatus.Starting);
		});

		it("should transition to Failed on Error from various states", () => {
			const statesWithErrorTransition = [
				CyrusSessionStatus.Created,
				CyrusSessionStatus.Starting,
				CyrusSessionStatus.Running,
				CyrusSessionStatus.Completing,
				CyrusSessionStatus.Stopping,
			];

			for (const state of statesWithErrorTransition) {
				const sm = new SessionStateMachine("test", state);
				const result = sm.transition(SessionEvent.Error);

				expect(result.success).toBe(true);
				expect(result.newState).toBe(CyrusSessionStatus.Failed);
			}
		});
	});

	describe("invalid transitions", () => {
		it("should fail transition from Completed state", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Completed);
			const result = sm.transition(SessionEvent.InitializeRunner);

			expect(result.success).toBe(false);
			expect(result.newState).toBe(CyrusSessionStatus.Completed);
			expect(sm.getStatus()).toBe(CyrusSessionStatus.Completed);
		});

		it("should fail transition from Failed state", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Failed);
			const result = sm.transition(SessionEvent.Resume);

			expect(result.success).toBe(false);
			expect(result.newState).toBe(CyrusSessionStatus.Failed);
		});

		it("should throw InvalidTransitionError when throwOnInvalid is true", () => {
			const sm = new SessionStateMachine(
				"test-session",
				CyrusSessionStatus.Completed,
			);

			expect(() => sm.transition(SessionEvent.InitializeRunner, true)).toThrow(
				InvalidTransitionError,
			);
		});

		it("should include session ID in InvalidTransitionError", () => {
			const sm = new SessionStateMachine(
				"my-session-id",
				CyrusSessionStatus.Completed,
			);

			try {
				sm.transition(SessionEvent.InitializeRunner, true);
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidTransitionError);
				const ite = error as InvalidTransitionError;
				expect(ite.sessionId).toBe("my-session-id");
				expect(ite.currentState).toBe(CyrusSessionStatus.Completed);
				expect(ite.event).toBe(SessionEvent.InitializeRunner);
				expect(ite.message).toContain("my-session-id");
			}
		});
	});

	describe("canTransition", () => {
		it("should return true for valid transitions", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Created);
			expect(sm.canTransition(SessionEvent.InitializeRunner)).toBe(true);
		});

		it("should return false for invalid transitions", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Completed);
			expect(sm.canTransition(SessionEvent.InitializeRunner)).toBe(false);
		});
	});

	describe("getNextState", () => {
		it("should return next state for valid transitions", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Created);
			expect(sm.getNextState(SessionEvent.InitializeRunner)).toBe(
				CyrusSessionStatus.Starting,
			);
		});

		it("should return undefined for invalid transitions", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Completed);
			expect(sm.getNextState(SessionEvent.InitializeRunner)).toBeUndefined();
		});
	});

	describe("helper methods", () => {
		it("isTerminal should return true for Completed and Failed", () => {
			const completedSm = new SessionStateMachine(
				"test",
				CyrusSessionStatus.Completed,
			);
			const failedSm = new SessionStateMachine(
				"test",
				CyrusSessionStatus.Failed,
			);
			const runningSm = new SessionStateMachine(
				"test",
				CyrusSessionStatus.Running,
			);

			expect(completedSm.isTerminal()).toBe(true);
			expect(failedSm.isTerminal()).toBe(true);
			expect(runningSm.isTerminal()).toBe(false);
		});

		it("isActive should return true for Starting, Running, and Completing", () => {
			const activeStates = [
				CyrusSessionStatus.Starting,
				CyrusSessionStatus.Running,
				CyrusSessionStatus.Completing,
			];
			const inactiveStates = [
				CyrusSessionStatus.Created,
				CyrusSessionStatus.Stopping,
				CyrusSessionStatus.Stopped,
				CyrusSessionStatus.Completed,
				CyrusSessionStatus.Failed,
			];

			for (const state of activeStates) {
				const sm = new SessionStateMachine("test", state);
				expect(sm.isActive()).toBe(true);
			}

			for (const state of inactiveStates) {
				const sm = new SessionStateMachine("test", state);
				expect(sm.isActive()).toBe(false);
			}
		});

		it("canResume should return true only for Stopped", () => {
			const stoppedSm = new SessionStateMachine(
				"test",
				CyrusSessionStatus.Stopped,
			);
			const completedSm = new SessionStateMachine(
				"test",
				CyrusSessionStatus.Completed,
			);

			expect(stoppedSm.canResume()).toBe(true);
			expect(completedSm.canResume()).toBe(false);
		});
	});

	describe("transition history", () => {
		it("should track transition history", () => {
			const sm = new SessionStateMachine("test");
			sm.transition(SessionEvent.InitializeRunner);
			sm.transition(SessionEvent.RunnerInitialized);
			sm.transition(SessionEvent.MessageReceived);

			const history = sm.getTransitionHistory();
			expect(history.length).toBe(3);
			expect(history[0].event).toBe(SessionEvent.InitializeRunner);
			expect(history[1].event).toBe(SessionEvent.RunnerInitialized);
			expect(history[2].event).toBe(SessionEvent.MessageReceived);
		});

		it("should include timestamps in history", () => {
			const sm = new SessionStateMachine("test");
			const before = Date.now();
			sm.transition(SessionEvent.InitializeRunner);
			const after = Date.now();

			const history = sm.getTransitionHistory();
			expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
			expect(history[0].timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe("serialization", () => {
		it("should serialize state machine", () => {
			const sm = new SessionStateMachine(
				"test-session",
				CyrusSessionStatus.Running,
			);
			const serialized = sm.serialize();

			expect(serialized.sessionId).toBe("test-session");
			expect(serialized.status).toBe(CyrusSessionStatus.Running);
		});

		it("should deserialize state machine", () => {
			const data = {
				sessionId: "restored-session",
				status: CyrusSessionStatus.Stopping,
			};

			const sm = SessionStateMachine.deserialize(data);

			expect(sm.getSessionId()).toBe("restored-session");
			expect(sm.getStatus()).toBe(CyrusSessionStatus.Stopping);
		});
	});

	describe("forceSetState", () => {
		it("should allow forcing state without validation", () => {
			const sm = new SessionStateMachine("test", CyrusSessionStatus.Completed);

			// This would normally be invalid
			sm.forceSetState(CyrusSessionStatus.Running);

			expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);
		});
	});
});

describe("toLinearStatus", () => {
	it("should map Created to Pending", () => {
		expect(toLinearStatus(CyrusSessionStatus.Created)).toBe(
			AgentSessionStatus.Pending,
		);
	});

	it("should map Starting and Running to Active", () => {
		expect(toLinearStatus(CyrusSessionStatus.Starting)).toBe(
			AgentSessionStatus.Active,
		);
		expect(toLinearStatus(CyrusSessionStatus.Running)).toBe(
			AgentSessionStatus.Active,
		);
	});

	it("should map Stopping and Completing to Active", () => {
		expect(toLinearStatus(CyrusSessionStatus.Stopping)).toBe(
			AgentSessionStatus.Active,
		);
		expect(toLinearStatus(CyrusSessionStatus.Completing)).toBe(
			AgentSessionStatus.Active,
		);
	});

	it("should map Stopped to Stale", () => {
		expect(toLinearStatus(CyrusSessionStatus.Stopped)).toBe(
			AgentSessionStatus.Stale,
		);
	});

	it("should map Completed to Complete", () => {
		expect(toLinearStatus(CyrusSessionStatus.Completed)).toBe(
			AgentSessionStatus.Complete,
		);
	});

	it("should map Failed to Error", () => {
		expect(toLinearStatus(CyrusSessionStatus.Failed)).toBe(
			AgentSessionStatus.Error,
		);
	});

	it("should return correct Linear status from state machine", () => {
		const sm = new SessionStateMachine("test", CyrusSessionStatus.Running);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active);

		sm.transition(SessionEvent.ResultReceived);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active); // Completing

		sm.transition(SessionEvent.CleanupComplete);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Complete);
	});
});

describe("full session lifecycle", () => {
	it("should handle happy path: Created -> Starting -> Running -> Completing -> Completed", () => {
		const sm = new SessionStateMachine("lifecycle-test");

		expect(sm.getStatus()).toBe(CyrusSessionStatus.Created);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Pending);

		sm.transition(SessionEvent.InitializeRunner);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Starting);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active);

		sm.transition(SessionEvent.RunnerInitialized);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active);

		// Process some messages
		sm.transition(SessionEvent.MessageReceived);
		sm.transition(SessionEvent.MessageReceived);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);

		sm.transition(SessionEvent.ResultReceived);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Completing);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active);

		sm.transition(SessionEvent.CleanupComplete);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Completed);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Complete);
		expect(sm.isTerminal()).toBe(true);
	});

	it("should handle stop and resume: Running -> Stopping -> Stopped -> Starting -> Running", () => {
		const sm = new SessionStateMachine("stop-resume-test");

		// Get to running state
		sm.transition(SessionEvent.InitializeRunner);
		sm.transition(SessionEvent.RunnerInitialized);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);

		// Stop
		sm.transition(SessionEvent.StopSignal);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Stopping);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active);

		sm.transition(SessionEvent.RunnerStopped);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Stopped);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Stale);
		expect(sm.canResume()).toBe(true);

		// Resume
		sm.transition(SessionEvent.Resume);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Starting);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Active);

		sm.transition(SessionEvent.RunnerInitialized);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);
	});

	it("should handle error during processing", () => {
		const sm = new SessionStateMachine("error-test");

		sm.transition(SessionEvent.InitializeRunner);
		sm.transition(SessionEvent.RunnerInitialized);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Running);

		sm.transition(SessionEvent.Error);
		expect(sm.getStatus()).toBe(CyrusSessionStatus.Failed);
		expect(sm.getLinearStatus()).toBe(AgentSessionStatus.Error);
		expect(sm.isTerminal()).toBe(true);
	});
});
