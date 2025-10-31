/**
 * Linear Issue Tracker Adapter
 *
 * This module provides a Linear implementation of the IssueTracker interface.
 */

export type { LinearIssueTrackerConfig } from "./LinearIssueTracker.js";
export { LinearIssueTracker } from "./LinearIssueTracker.js";
export {
	mapIssueStateType,
	mapLinearAttachment,
	mapLinearComment,
	mapLinearIssue,
	mapLinearLabel,
	mapLinearState,
	mapLinearUser,
} from "./mappers.js";
