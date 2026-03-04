import { beforeEach, describe, expect, it } from "vitest";
import { CLIIssueTrackerService } from "../src/issue-tracker/adapters/CLIIssueTrackerService";

describe("CLIIssueTrackerService - Label Operations", () => {
	let service: CLIIssueTrackerService;

	beforeEach(() => {
		service = new CLIIssueTrackerService();
		service.seedDefaultData();
	});

	describe("findOrCreateLabel", () => {
		it("should create a new label when it doesn't exist", async () => {
			const labelId = await service.findOrCreateLabel("sonnet");

			expect(labelId).toMatch(/^label-/);

			// Verify the label was created
			const label = await service.fetchLabel(labelId);
			expect(label.name).toBe("sonnet");
			expect(label.color).toBeDefined();
		});

		it("should return existing label ID when label already exists", async () => {
			// Create label first time
			const firstLabelId = await service.findOrCreateLabel("feature");

			// Request same label again
			const secondLabelId = await service.findOrCreateLabel("feature");

			// Should return same ID
			expect(secondLabelId).toBe(firstLabelId);
		});

		it("should handle multiple different labels", async () => {
			const labelId1 = await service.findOrCreateLabel("sonnet");
			const labelId2 = await service.findOrCreateLabel("opus");
			const labelId3 = await service.findOrCreateLabel("haiku");

			// All should be different
			expect(labelId1).not.toBe(labelId2);
			expect(labelId2).not.toBe(labelId3);
			expect(labelId1).not.toBe(labelId3);

			// All should be retrievable
			const label1 = await service.fetchLabel(labelId1);
			const label2 = await service.fetchLabel(labelId2);
			const label3 = await service.fetchLabel(labelId3);

			expect(label1.name).toBe("sonnet");
			expect(label2.name).toBe("opus");
			expect(label3.name).toBe("haiku");
		});

		it("should generate consistent colors for same label name", async () => {
			const labelId = await service.findOrCreateLabel("test-label");
			const label = await service.fetchLabel(labelId);

			// Color should be a valid hex color
			expect(label.color).toMatch(/^#[0-9a-f]{6}$/i);
		});
	});

	describe("createIssue with labels", () => {
		it("should create issue with label IDs after findOrCreateLabel", async () => {
			// First create labels
			const labelId1 = await service.findOrCreateLabel("sonnet");
			const labelId2 = await service.findOrCreateLabel("feature");

			// Create issue with those label IDs
			const issue = await service.createIssue({
				teamId: "team-default",
				title: "Test Issue with Labels",
				labelIds: [labelId1, labelId2],
			});

			// Verify labels are attached
			expect(issue.labelIds).toContain(labelId1);
			expect(issue.labelIds).toContain(labelId2);

			// Verify labels() method returns the labels
			const labels = await issue.labels();
			expect(labels.nodes).toHaveLength(2);
			expect(labels.nodes.map((l) => l.name).sort()).toEqual([
				"feature",
				"sonnet",
			]);
		});

		it("should persist labels across multiple issues", async () => {
			// Create a label
			const labelId = await service.findOrCreateLabel("shared-label");

			// Create first issue with label
			const issue1 = await service.createIssue({
				teamId: "team-default",
				title: "Issue 1",
				labelIds: [labelId],
			});

			// Create second issue with same label
			const issue2 = await service.createIssue({
				teamId: "team-default",
				title: "Issue 2",
				labelIds: [labelId],
			});

			// Both should have the same label
			expect(issue1.labelIds).toContain(labelId);
			expect(issue2.labelIds).toContain(labelId);

			const labels1 = await issue1.labels();
			const labels2 = await issue2.labels();

			expect(labels1.nodes[0].id).toBe(labels2.nodes[0].id);
			expect(labels1.nodes[0].name).toBe("shared-label");
		});
	});

	describe("getIssueLabels", () => {
		it("should return label names for issue", async () => {
			// Create labels and issue
			const labelId1 = await service.findOrCreateLabel("alpha");
			const labelId2 = await service.findOrCreateLabel("beta");

			const issue = await service.createIssue({
				teamId: "team-default",
				title: "Test Issue",
				labelIds: [labelId1, labelId2],
			});

			// Get label names
			const labelNames = await service.getIssueLabels(issue.id);

			expect(labelNames).toHaveLength(2);
			expect(labelNames.sort()).toEqual(["alpha", "beta"]);
		});
	});
});
