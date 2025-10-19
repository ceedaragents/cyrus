/**
 * cyrus-adapter-linear
 *
 * Linear-specific implementation of IUserInterface for Cyrus.
 * Translates between Linear's API/webhooks and Cyrus's abstract WorkItem/Activity model.
 */
export { LinearAdapter } from "./LinearAdapter.js";
export type { LinearAdapterConfig, Logger } from "./types.js";
export { defaultLogger } from "./types.js";
export {
	translateWebhookToWorkItem,
	translateActivityToLinear,
	translateWorkItemUpdate,
} from "./translators.js";
//# sourceMappingURL=index.d.ts.map
