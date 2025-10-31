/**
 * Unit tests for Linear type mappers
 */

import { describe, expect, it } from "vitest";
import {
	mapIssueStateType,
	mapLinearAttachment,
	mapLinearLabel,
	mapLinearState,
	mapLinearUser,
} from "../../src/linear/mappers.js";

describe("mapLinearState", () => {
	it("should map Linear WorkflowState to IssueState", () => {
		const linearState = {
			id: "state-123",
			name: "In Progress",
			type: "started" as const,
			position: 1,
		} as any;

		const result = mapLinearState(linearState);

		expect(result).toEqual({
			type: "started",
			name: "In Progress",
			id: "state-123",
		});
	});

	it("should handle all state types", () => {
		const types = [
			"triage",
			"backlog",
			"unstarted",
			"started",
			"completed",
			"canceled",
		] as const;

		types.forEach((type) => {
			const linearState = {
				id: `state-${type}`,
				name: type,
				type,
				position: 1,
			} as any;

			const result = mapLinearState(linearState);
			expect(result.type).toBe(type);
		});
	});
});

describe("mapLinearUser", () => {
	it("should map Linear User to Member", () => {
		const linearUser = {
			id: "user-123",
			name: "johndoe",
			displayName: "John Doe",
			email: "john@example.com",
			avatarUrl: "https://example.com/avatar.jpg",
		} as any;

		const result = mapLinearUser(linearUser);

		expect(result).toEqual({
			id: "user-123",
			name: "John Doe",
			email: "john@example.com",
			avatarUrl: "https://example.com/avatar.jpg",
		});
	});

	it("should fallback to name if displayName is missing", () => {
		const linearUser = {
			id: "user-123",
			name: "johndoe",
			email: "john@example.com",
		} as any;

		const result = mapLinearUser(linearUser);

		expect(result.name).toBe("johndoe");
	});

	it("should handle missing optional fields", () => {
		const linearUser = {
			id: "user-123",
			name: "johndoe",
		} as any;

		const result = mapLinearUser(linearUser);

		expect(result).toEqual({
			id: "user-123",
			name: "johndoe",
			email: undefined,
			avatarUrl: undefined,
		});
	});
});

describe("mapLinearLabel", () => {
	it("should map Linear IssueLabel to Label", () => {
		const linearLabel = {
			id: "label-123",
			name: "bug",
			color: "#ff0000",
			description: "Bug report",
		} as any;

		const result = mapLinearLabel(linearLabel);

		expect(result).toEqual({
			id: "label-123",
			name: "bug",
			color: "#ff0000",
			description: "Bug report",
		});
	});

	it("should handle missing optional fields", () => {
		const linearLabel = {
			id: "label-123",
			name: "feature",
		} as any;

		const result = mapLinearLabel(linearLabel);

		expect(result).toEqual({
			id: "label-123",
			name: "feature",
			color: undefined,
			description: undefined,
		});
	});
});

describe("mapLinearAttachment", () => {
	it("should map Linear Attachment to Attachment", () => {
		const linearAttachment = {
			id: "att-123",
			title: "screenshot.png",
			url: "https://example.com/file.png",
			metadata: {
				contentType: "image/png",
				size: 1024,
			},
		} as any;

		const result = mapLinearAttachment(linearAttachment);

		expect(result).toEqual({
			name: "screenshot.png",
			url: "https://example.com/file.png",
			mimeType: "image/png",
			size: 1024,
		});
	});

	it("should fallback to url if title is missing", () => {
		const linearAttachment = {
			id: "att-123",
			url: "https://example.com/file.png",
		} as any;

		const result = mapLinearAttachment(linearAttachment);

		expect(result.name).toBe("https://example.com/file.png");
	});

	it("should handle missing metadata", () => {
		const linearAttachment = {
			id: "att-123",
			title: "file.pdf",
			url: "https://example.com/file.pdf",
		} as any;

		const result = mapLinearAttachment(linearAttachment);

		expect(result).toEqual({
			name: "file.pdf",
			url: "https://example.com/file.pdf",
			mimeType: undefined,
			size: undefined,
		});
	});
});

describe("mapIssueStateType", () => {
	it("should return the same state type", () => {
		expect(mapIssueStateType("started")).toBe("started");
		expect(mapIssueStateType("completed")).toBe("completed");
		expect(mapIssueStateType("canceled")).toBe("canceled");
	});
});
