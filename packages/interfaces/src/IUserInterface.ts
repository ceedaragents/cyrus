/**
 * Represents any system that can send work to Cyrus and receive results.
 * This interface abstracts the concept of a user interface, allowing Cyrus
 * to work with different input/output systems (Linear, CLI, HTTP, etc.).
 */
export interface IUserInterface {
  /**
   * Initialize the user interface, setting up any necessary connections
   * or event listeners.
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the user interface, cleaning up connections and resources.
   */
  shutdown(): Promise<void>;

  /**
   * Register a handler to be called when a new work item is received.
   * Work items flow INTO Cyrus from the user interface.
   *
   * @param handler - Function to handle incoming work items
   */
  onWorkItem(handler: (item: WorkItem) => void | Promise<void>): void;

  /**
   * Post an activity update to the user interface.
   * Activities flow OUT OF Cyrus to the user interface.
   *
   * @param activity - The activity to post
   */
  postActivity(activity: Activity): Promise<void>;

  /**
   * Update the status or properties of a work item.
   *
   * @param id - The ID of the work item to update
   * @param update - The updates to apply
   */
  updateWorkItem(id: string, update: WorkItemUpdate): Promise<void>;

  /**
   * Retrieve a work item by its ID.
   *
   * @param id - The ID of the work item
   * @returns The work item, if found
   */
  getWorkItem(id: string): Promise<WorkItem>;

  /**
   * Retrieve the activity history for a work item.
   *
   * @param id - The ID of the work item
   * @returns Array of activities for the work item
   */
  getWorkItemHistory(id: string): Promise<Activity[]>;
}

/**
 * Represents a unit of work that Cyrus should process.
 * Work items can be tasks, commands, or conversation turns.
 */
export interface WorkItem {
  /** Unique identifier for this work item */
  id: string;

  /** The type of work item */
  type: 'task' | 'command' | 'conversation';

  /** Title or summary of the work */
  title: string;

  /** Detailed description or instructions */
  description: string;

  /** Additional context needed to process the work item */
  context: Record<string, unknown>;

  /** Metadata about the work item */
  metadata: {
    /** The source system that created this work item */
    source: string;

    /** The assignee or owner of this work item */
    assignee?: string;

    /** Priority level (higher = more important) */
    priority?: number;

    /** Additional metadata fields */
    [key: string]: unknown;
  };
}

/**
 * Represents an activity or event that occurred while processing a work item.
 * Activities capture the agent's thoughts, actions, results, and errors.
 */
export interface Activity {
  /** Unique identifier for this activity */
  id: string;

  /** ID of the work item this activity relates to */
  workItemId: string;

  /** When this activity occurred */
  timestamp: Date;

  /** The type of activity */
  type: 'thought' | 'action' | 'result' | 'error';

  /** The content of the activity */
  content: ActivityContent;

  /** Additional metadata about the activity */
  metadata?: Record<string, unknown>;
}

/**
 * Union type representing different kinds of activity content.
 */
export type ActivityContent =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'error'; message: string; stack?: string };

/**
 * Represents updates that can be applied to a work item.
 */
export interface WorkItemUpdate {
  /** Updated status of the work item */
  status?: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

  /** Progress percentage (0-100) */
  progress?: number;

  /** Status message or description */
  message?: string;

  /** Error information if status is 'failed' */
  error?: Error;
}
