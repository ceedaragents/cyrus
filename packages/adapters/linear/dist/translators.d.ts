import type { WorkItem, Activity, WorkItemUpdate } from "cyrus-interfaces";
import type { LinearWebhook } from "cyrus-core";
import type { LinearDocument } from "@linear/sdk";
/**
 * Translates a Linear webhook payload to a WorkItem
 * Returns null if the webhook type is not supported or should be ignored
 */
export declare function translateWebhookToWorkItem(
	webhook: LinearWebhook,
): WorkItem | null;
/**
 * Translates a Cyrus Activity to Linear AgentActivityCreateInput
 */
export declare function translateActivityToLinear(
	activity: Activity,
	agentSessionId: string,
): LinearDocument.AgentActivityCreateInput;
/**
 * Translates WorkItemUpdate to Linear issue update operations
 * Returns update data that can be used with Linear SDK
 */
export declare function translateWorkItemUpdate(update: WorkItemUpdate): {
	stateUpdate?: {
		name: string;
	};
	progressUpdate?: number;
	commentUpdate?: string;
};
//# sourceMappingURL=translators.d.ts.map
