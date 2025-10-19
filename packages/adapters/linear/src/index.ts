/**
 * cyrus-adapter-linear
 *
 * Linear-specific implementation of IUserInterface for Cyrus.
 * Translates between Linear's API/webhooks and Cyrus's abstract WorkItem/Activity model.
 */

export { LinearAdapter } from "./LinearAdapter.js";
export {
	translateActivityToLinear,
	translateWebhookToWorkItem,
	translateWorkItemUpdate,
} from "./translators.js";
export type { LinearAdapterConfig, Logger } from "./types.js";
export { defaultLogger } from "./types.js";
