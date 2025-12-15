import { describe, expect, it } from "vitest";
import {
	type CLIIssueData,
	type CLILabelData,
	createCLIIssue,
} from "../src/issue-tracker/adapters/CLITypes";

describe("createCLIIssue", () => {
	it("should return labels when labelIds are present", async () => {
		const issueData: CLIIssueData = {
			id: "issue-1",
			identifier: "CY-1",
			title: "Test Issue",
			number: 1,
			url: "https://linear.app/test/CY-1",
			branchName: "cy-1",
			priority: 0,
			priorityLabel: "No Priority",
			boardOrder: 0,
			sortOrder: 0,
			prioritySortOrder: 0,
			labelIds: ["label-1", "label-2"],
			previousIdentifiers: [],
			customerTicketCount: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		const resolvedLabels: CLILabelData[] = [
			{
				id: "label-1",
				name: "Label 1",
				color: "#ff0000",
				isGroup: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: "label-2",
				name: "Label 2",
				color: "#0000ff",
				isGroup: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];

		const issue = createCLIIssue(issueData, resolvedLabels);
		const labels = await issue.labels();

		// This is expected to fail currently because labels() returns empty array
		expect(labels.nodes).toHaveLength(2);
		expect(labels.nodes[0].name).toBe("Label 1");
		expect(labels.nodes[1].name).toBe("Label 2");
	});
});
