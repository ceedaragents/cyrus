import type {
	IUserInterface,
	WorkItem,
	Activity,
	WorkItemUpdate,
} from "cyrus-interfaces";
import type { LinearAdapterConfig } from "./types.js";
/**
 * Linear-specific implementation of IUserInterface
 *
 * This adapter translates between Linear's API/webhooks and Cyrus's abstract
 * WorkItem/Activity model, hiding all Linear-specific details behind the interface.
 */
export declare class LinearAdapter implements IUserInterface {
	private linearClient;
	private webhookClient;
	private logger;
	private workItemHandler?;
	private initialized;
	/**
	 * Maps WorkItem IDs to Linear agent session IDs
	 * This is needed to post activities to the correct Linear session
	 */
	private workItemToSessionMap;
	constructor(config: LinearAdapterConfig);
	/**
	 * Initialize the adapter - sets up webhook listeners
	 */
	initialize(): Promise<void>;
	/**
	 * Shutdown the adapter - cleanup connections
	 */
	shutdown(): Promise<void>;
	/**
	 * Register a handler for incoming work items
	 * This is called when Linear webhooks are received and translated to WorkItems
	 */
	onWorkItem(handler: (item: WorkItem) => void | Promise<void>): void;
	/**
	 * Post an activity to Linear as an agent activity
	 */
	postActivity(activity: Activity): Promise<void>;
	/**
	 * Update a work item's status, progress, or add a message
	 */
	updateWorkItem(id: string, update: WorkItemUpdate): Promise<void>;
	/**
	 * Get a work item by ID (fetches Linear issue)
	 */
	getWorkItem(id: string): Promise<WorkItem>;
	/**
	 * Get activity history for a work item
	 * Fetches Linear agent activities for the associated agent session
	 */
	getWorkItemHistory(id: string): Promise<Activity[]>;
	/**
	 * Internal handler for incoming Linear webhooks
	 */
	private handleWebhook;
	/**
	 * Ensures the adapter is initialized before operations
	 */
	private ensureInitialized;
}
//# sourceMappingURL=LinearAdapter.d.ts.map
