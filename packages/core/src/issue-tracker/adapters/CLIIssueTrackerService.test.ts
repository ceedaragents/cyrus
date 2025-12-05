import { beforeEach, describe, expect, it } from "vitest";
import { CLIIssueTrackerService } from "./CLIIssueTrackerService.js";
import type { CLILabelData } from "./CLITypes.js";

describe("CLIIssueTrackerService - Label Handling", () => {
	let service: CLIIssueTrackerService;

	beforeEach(() => {
		service = new CLIIssueTrackerService();
		service.seedDefaultData();
	});

	describe("Issue labels() method", () => {
		it("should return actual labels when issue has labelIds", async () => {
			// Create test labels
			const bugLabel: CLILabelData = {
				id: "label-bug",
				name: "bug",
				color: "#ff0000",
				isGroup: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const featureLabel: CLILabelData = {
				id: "label-feature",
				name: "feature",
				color: "#00ff00",
				isGroup: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// Add labels to service state
			service.state.labels.set(bugLabel.id, bugLabel);
			service.state.labels.set(featureLabel.id, featureLabel);

			// Create issue with labels
			const issue = await service.createIssue({
				teamId: "team-default",
				title: "Test Issue with Labels",
				description: "This issue should have labels",
				labelIds: ["label-bug", "label-feature"],
			});

			// BUG: This call returns empty array instead of actual labels
			const labelsConnection = await issue.labels();

			// These assertions should pass but currently FAIL
			expect(labelsConnection.nodes).toHaveLength(2);
			expect(labelsConnection.nodes.map((l) => l.name)).toContain("bug");
			expect(labelsConnection.nodes.map((l) => l.name)).toContain("feature");
		});

		it("should return empty array when issue has no labelIds", async () => {
			// Create issue without labels
			const issue = await service.createIssue({
				teamId: "team-default",
				title: "Test Issue without Labels",
			});

			const labelsConnection = await issue.labels();

			expect(labelsConnection.nodes).toHaveLength(0);
		});

		it("should work with EdgeWorker's fetchIssueLabels pattern", async () => {
			// Create test label
			const codexLabel: CLILabelData = {
				id: "label-codex",
				name: "codex",
				color: "#0000ff",
				isGroup: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			service.state.labels.set(codexLabel.id, codexLabel);

			// Create issue with codex label
			const issue = await service.createIssue({
				teamId: "team-default",
				title: "Test CodexRunner Selection",
				labelIds: ["label-codex"],
			});

			// Simulate EdgeWorker's fetchIssueLabels logic
			const labelsConnection = await issue.labels();
			const labelNames = labelsConnection.nodes.map((label) => label.name);

			// This should contain "codex" but currently returns empty array
			expect(labelNames).toContain("codex");
			expect(labelNames).toHaveLength(1);
		});
	});

	describe("getIssueLabels method (workaround)", () => {
		it("should return correct label names using getIssueLabels", async () => {
			// Create test label
			const bugLabel: CLILabelData = {
				id: "label-bug",
				name: "bug",
				color: "#ff0000",
				isGroup: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			service.state.labels.set(bugLabel.id, bugLabel);

			// Create issue with label
			const issue = await service.createIssue({
				teamId: "team-default",
				title: "Test Issue",
				labelIds: ["label-bug"],
			});

			// This workaround method should work
			const labelNames = await service.getIssueLabels(issue.id);

			expect(labelNames).toContain("bug");
			expect(labelNames).toHaveLength(1);
		});
	});
});
