/**
 * Issue Tracker Adapters for Cyrus
 *
 * This package provides adapters that implement the IssueTracker interface
 * for various issue tracking systems.
 *
 * @packageDocumentation
 */

export type { LinearIssueTrackerConfig } from "./linear/index.js";
// Re-export Linear adapter
// Re-export mappers (useful for testing and custom implementations)
export {
	LinearIssueTracker,
	mapIssueStateType,
	mapLinearAttachment,
	mapLinearComment,
	mapLinearIssue,
	mapLinearLabel,
	mapLinearState,
	mapLinearUser,
} from "./linear/index.js";
