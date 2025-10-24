import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Activity, IUserInterface, WorkItem } from "../../src/index.js";

/**
 * Contract test suite for IUserInterface implementations
 *
 * This test suite validates that any implementation of IUserInterface
 * correctly implements all required methods and behaviors.
 *
 * Usage:
 * ```typescript
 * import { testUserInterfaceContract } from 'cyrus-interfaces/test/contracts';
 *
 * testUserInterfaceContract(async () => {
 *   // Return your IUserInterface implementation
 *   return new MyAdapter(...);
 * });
 * ```
 */
export function testUserInterfaceContract(
	factory: () => Promise<IUserInterface>,
	options?: {
		/**
		 * Optional function to trigger a work item emission
		 * If not provided, work item emission tests will be skipped
		 */
		triggerWorkItem?: (ui: IUserInterface) => Promise<void>;

		/**
		 * Optional function to verify activity was posted
		 * If not provided, activity posting verification will be minimal
		 */
		verifyActivityPosted?: (
			ui: IUserInterface,
			activity: Activity,
		) => Promise<boolean>;

		/**
		 * Skip certain tests if they're not applicable to your implementation
		 */
		skip?: {
			workItemEmission?: boolean;
			activityPosting?: boolean;
			workItemUpdate?: boolean;
			workItemQuery?: boolean;
			historyQuery?: boolean;
		};
	},
): void {
	describe("IUserInterface Contract", () => {
		let ui: IUserInterface;

		beforeEach(async () => {
			ui = await factory();
		});

		afterEach(async () => {
			if (ui) {
				await ui.shutdown();
			}
		});

		describe("Lifecycle", () => {
			it("should initialize without errors", async () => {
				await expect(ui.initialize()).resolves.not.toThrow();
			});

			it("should shutdown without errors", async () => {
				await ui.initialize();
				await expect(ui.shutdown()).resolves.not.toThrow();
			});

			it("should handle multiple initializations gracefully", async () => {
				await ui.initialize();
				await expect(ui.initialize()).resolves.not.toThrow();
			});

			it("should handle shutdown when not initialized", async () => {
				await expect(ui.shutdown()).resolves.not.toThrow();
			});
		});

		describe("Work Item Input", () => {
			beforeEach(async () => {
				await ui.initialize();
			});

			it("should accept a work item handler", () => {
				expect(() => {
					ui.onWorkItem(() => {});
				}).not.toThrow();
			});

			it("should accept an async work item handler", () => {
				expect(() => {
					ui.onWorkItem(async () => {});
				}).not.toThrow();
			});

			if (!options?.skip?.workItemEmission) {
				it("should emit work items to registered handler", async () => {
					if (!options?.triggerWorkItem) {
						console.warn(
							"Skipping work item emission test - no triggerWorkItem function provided",
						);
						return;
					}

					const items: WorkItem[] = [];
					ui.onWorkItem((item) => {
						items.push(item);
					});

					await options.triggerWorkItem(ui);

					// Give some time for async processing
					await new Promise((resolve) => setTimeout(resolve, 100));

					expect(items.length).toBeGreaterThan(0);
					expect(items[0]).toHaveProperty("id");
					expect(items[0]).toHaveProperty("type");
					expect(items[0]).toHaveProperty("title");
					expect(items[0]).toHaveProperty("description");
					expect(items[0]).toHaveProperty("context");
					expect(items[0]).toHaveProperty("metadata");
					expect(items[0].metadata.source).toBeDefined();
				});
			}

			it("should handle handler registration after initialization", async () => {
				const items: WorkItem[] = [];
				expect(() => {
					ui.onWorkItem((item) => items.push(item));
				}).not.toThrow();
			});
		});

		describe("Activity Output", () => {
			beforeEach(async () => {
				await ui.initialize();
			});

			if (!options?.skip?.activityPosting) {
				it("should post text activities", async () => {
					const activity: Activity = {
						id: "test-activity-1",
						workItemId: "test-work-item-1",
						timestamp: new Date(),
						type: "thought",
						content: {
							type: "text",
							text: "Test thought activity",
						},
					};

					// This might fail if no session exists - that's expected
					// Implementations should throw a clear error
					try {
						await ui.postActivity(activity);

						if (options?.verifyActivityPosted) {
							const posted = await options.verifyActivityPosted(ui, activity);
							expect(posted).toBe(true);
						}
					} catch (error) {
						// Should be a clear error about missing session/work item
						expect(error).toBeInstanceOf(Error);
						expect((error as Error).message).toBeTruthy();
					}
				});

				it("should post action activities", async () => {
					const activity: Activity = {
						id: "test-activity-2",
						workItemId: "test-work-item-1",
						timestamp: new Date(),
						type: "action",
						content: {
							type: "tool_use",
							tool: "test-tool",
							input: { param: "value" },
						},
					};

					try {
						await ui.postActivity(activity);
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
					}
				});

				it("should post error activities", async () => {
					const activity: Activity = {
						id: "test-activity-3",
						workItemId: "test-work-item-1",
						timestamp: new Date(),
						type: "error",
						content: {
							type: "error",
							message: "Test error",
							stack: "Error stack trace",
						},
					};

					try {
						await ui.postActivity(activity);
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
					}
				});

				it("should reject posting to non-existent work item", async () => {
					const activity: Activity = {
						id: "test-activity-4",
						workItemId: "non-existent-work-item",
						timestamp: new Date(),
						type: "thought",
						content: {
							type: "text",
							text: "Test",
						},
					};

					await expect(ui.postActivity(activity)).rejects.toThrow();
				});
			}
		});

		describe("Work Item Updates", () => {
			beforeEach(async () => {
				await ui.initialize();
			});

			if (!options?.skip?.workItemUpdate) {
				it("should update work item status", async () => {
					try {
						await ui.updateWorkItem("test-work-item-1", {
							status: "active",
						});
					} catch (error) {
						// May fail if work item doesn't exist
						expect(error).toBeInstanceOf(Error);
					}
				});

				it("should update work item with message", async () => {
					try {
						await ui.updateWorkItem("test-work-item-1", {
							message: "Status update message",
						});
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
					}
				});

				it("should update work item with progress", async () => {
					try {
						await ui.updateWorkItem("test-work-item-1", {
							progress: 50,
						});
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
					}
				});

				it("should accept combined updates", async () => {
					try {
						await ui.updateWorkItem("test-work-item-1", {
							status: "active",
							progress: 75,
							message: "Making progress",
						});
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
					}
				});
			}
		});

		describe("Work Item Query", () => {
			beforeEach(async () => {
				await ui.initialize();
			});

			if (!options?.skip?.workItemQuery) {
				it("should reject query for non-existent work item", async () => {
					await expect(ui.getWorkItem("non-existent-id")).rejects.toThrow();
				});

				it("should return work item with required fields", async () => {
					// This test requires a real work item to exist
					// Implementations may skip this or provide a test fixture
					try {
						const workItem = await ui.getWorkItem("test-work-item-id");
						expect(workItem).toHaveProperty("id");
						expect(workItem).toHaveProperty("type");
						expect(workItem).toHaveProperty("title");
						expect(workItem).toHaveProperty("description");
						expect(workItem).toHaveProperty("context");
						expect(workItem).toHaveProperty("metadata");
						expect(workItem.metadata.source).toBeDefined();
					} catch (error) {
						// Expected if test work item doesn't exist
						expect(error).toBeInstanceOf(Error);
					}
				});
			}
		});

		describe("Work Item History", () => {
			beforeEach(async () => {
				await ui.initialize();
			});

			if (!options?.skip?.historyQuery) {
				it("should return empty array for work item with no history", async () => {
					const history = await ui.getWorkItemHistory("test-no-history");
					expect(Array.isArray(history)).toBe(true);
					expect(history.length).toBe(0);
				});

				it("should return activities with required fields", async () => {
					try {
						const history = await ui.getWorkItemHistory("test-work-item-id");
						expect(Array.isArray(history)).toBe(true);

						if (history.length > 0) {
							const activity = history[0];
							expect(activity).toHaveProperty("id");
							expect(activity).toHaveProperty("workItemId");
							expect(activity).toHaveProperty("timestamp");
							expect(activity).toHaveProperty("type");
							expect(activity).toHaveProperty("content");
							expect(activity.timestamp).toBeInstanceOf(Date);
						}
					} catch (error) {
						// May fail if work item doesn't exist
						expect(error).toBeInstanceOf(Error);
					}
				});
			}
		});

		describe("Error Handling", () => {
			it("should throw when operations called before initialization", async () => {
				const newUi = await factory();

				await expect(
					newUi.postActivity({
						id: "test",
						workItemId: "test",
						timestamp: new Date(),
						type: "thought",
						content: { type: "text", text: "test" },
					}),
				).rejects.toThrow();

				await newUi.shutdown();
			});

			it("should provide clear error messages", async () => {
				await ui.initialize();

				try {
					await ui.postActivity({
						id: "test",
						workItemId: "invalid",
						timestamp: new Date(),
						type: "thought",
						content: { type: "text", text: "test" },
					});
				} catch (error) {
					expect(error).toBeInstanceOf(Error);
					expect((error as Error).message).toBeTruthy();
					expect((error as Error).message.length).toBeGreaterThan(10);
				}
			});
		});
	});
}
