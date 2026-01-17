/**
 * ParallelTaskTracker manages unified display of parallel Task tool executions.
 *
 * When Claude calls multiple Task tools in parallel (multiple tool_use blocks in a single
 * assistant message), this tracker consolidates them into a single ephemeral activity
 * showing a tree view like Claude Code's native display:
 *
 * ```
 * ● Running 6 agents...
 * ├── Explore cyrus desktop app · 17 tool uses · 44.6k tokens
 * │   └─Read: ~/code/cyrus/packages/edge-worker/src/EdgeWorker.ts
 * ├── Explore cyrus-hosted backend · 15 tool uses · 32.1k tokens
 * │   └─Read: apps/api/supabase/migrations/...
 * └── Explore cyrus-images · 13 tool uses · 31.6k tokens
 *     └─Done
 * ```
 *
 * Key behaviors:
 * - Detects when multiple Task tools are called in a single message (parallel execution)
 * - Creates a single ephemeral activity that updates as subtasks progress
 * - Tracks each agent's: description, tool count, current action status
 * - Replaces the ephemeral activity when all agents complete
 */

/**
 * Represents a single parallel agent being tracked
 */
export interface ParallelAgent {
	/** Unique tool_use_id for this Task */
	toolUseId: string;
	/** Description from the Task tool input (e.g., "Explore cyrus desktop app") */
	description: string;
	/** Number of tool calls made by this agent */
	toolCount: number;
	/** Current action being performed (e.g., "Read: path/to/file.ts") */
	currentAction: string;
	/** Whether this agent has completed */
	completed: boolean;
	/** Final result/status message */
	result?: string;
}

/**
 * Represents a group of parallel agents that should be displayed together
 */
export interface ParallelAgentGroup {
	/** Unique identifier for this group (based on timestamp of first detection) */
	groupId: string;
	/** The agents in this parallel group */
	agents: Map<string, ParallelAgent>;
	/** Linear activity ID for the ephemeral unified view */
	ephemeralActivityId?: string;
	/** Whether an ephemeral activity is being created (prevents race condition) */
	ephemeralActivityPending: boolean;
	/** Timestamp when the group was created */
	createdAt: number;
}

/**
 * Tracks parallel Task tool executions and manages unified activity display
 */
export class ParallelTaskTracker {
	/**
	 * Maps session ID to active parallel agent groups
	 * A session can have multiple groups if parallel tasks are launched at different times
	 */
	private groupsBySession: Map<string, ParallelAgentGroup[]> = new Map();

	/**
	 * Maps tool_use_id to the group it belongs to (for quick lookup)
	 */
	private toolUseIdToGroup: Map<
		string,
		{ sessionId: string; groupId: string }
	> = new Map();

	/**
	 * Detect if an assistant message contains multiple Task tool calls (parallel execution)
	 * Returns the tool_use blocks if parallel Tasks are detected, null otherwise
	 */
	detectParallelTasks(
		messageContent: Array<{
			type: string;
			id?: string;
			name?: string;
			input?: any;
		}>,
	): Array<{ id: string; name: string; input: any }> | null {
		const taskBlocks = messageContent.filter(
			(block) => block.type === "tool_use" && block.name === "Task",
		);

		// Only consider it "parallel" if there are 2+ Task tools in the same message
		if (taskBlocks.length >= 2) {
			return taskBlocks.map((block) => ({
				id: block.id!,
				name: block.name!,
				input: block.input,
			}));
		}

		return null;
	}

	/**
	 * Start tracking a new parallel agent group
	 */
	startParallelGroup(
		sessionId: string,
		tasks: Array<{ id: string; name: string; input: any }>,
	): ParallelAgentGroup {
		const groupId = `parallel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		const agents = new Map<string, ParallelAgent>();
		for (const task of tasks) {
			const description = this.extractTaskDescription(task.input);
			agents.set(task.id, {
				toolUseId: task.id,
				description,
				toolCount: 0,
				currentAction: "Starting...",
				completed: false,
			});

			// Register lookup for this tool_use_id
			this.toolUseIdToGroup.set(task.id, { sessionId, groupId });
		}

		const group: ParallelAgentGroup = {
			groupId,
			agents,
			ephemeralActivityPending: true, // Mark as pending synchronously
			createdAt: Date.now(),
		};

		// Add to session's groups
		const sessionGroups = this.groupsBySession.get(sessionId) || [];
		sessionGroups.push(group);
		this.groupsBySession.set(sessionId, sessionGroups);

		console.log(
			`[ParallelTaskTracker] Started parallel group ${groupId} with ${tasks.length} agents for session ${sessionId}`,
		);
		console.log(
			`[ParallelTaskTracker] Registered tool_use_ids:`,
			tasks.map((t) => t.id),
		);

		return group;
	}

	/**
	 * Extract task description from Task tool input
	 */
	private extractTaskDescription(input: any): string {
		if (typeof input === "string") {
			// Truncate long descriptions
			return input.length > 50 ? `${input.substring(0, 47)}...` : input;
		}
		if (input && typeof input === "object") {
			// Check common fields for description
			const desc =
				input.description || input.prompt || input.task || input.message;
			if (typeof desc === "string") {
				return desc.length > 50 ? `${desc.substring(0, 47)}...` : desc;
			}
		}
		return "Task agent";
	}

	/**
	 * Check if a tool_use_id is a parent of a parallel group
	 */
	isParallelTaskParent(toolUseId: string): boolean {
		return this.toolUseIdToGroup.has(toolUseId);
	}

	/**
	 * Get the parallel group for a tool_use_id
	 */
	getGroupForToolUseId(toolUseId: string): ParallelAgentGroup | null {
		const lookup = this.toolUseIdToGroup.get(toolUseId);
		if (!lookup) return null;

		const sessionGroups = this.groupsBySession.get(lookup.sessionId);
		if (!sessionGroups) return null;

		return sessionGroups.find((g) => g.groupId === lookup.groupId) || null;
	}

	/**
	 * Update an agent's current action (when it performs a tool call)
	 */
	updateAgentAction(
		parentToolUseId: string,
		toolName: string,
		toolInput: any,
	): ParallelAgentGroup | null {
		const group = this.getGroupForToolUseId(parentToolUseId);
		if (!group) return null;

		const agent = group.agents.get(parentToolUseId);
		if (!agent || agent.completed) return null;

		agent.toolCount++;
		agent.currentAction = this.formatCurrentAction(toolName, toolInput);

		return group;
	}

	/**
	 * Format the current action for display
	 */
	private formatCurrentAction(toolName: string, toolInput: any): string {
		// Extract a brief representation of the action
		let param = "";
		if (typeof toolInput === "string") {
			param = toolInput;
		} else if (toolInput && typeof toolInput === "object") {
			// Try common parameter names
			param =
				toolInput.file_path ||
				toolInput.path ||
				toolInput.pattern ||
				toolInput.command ||
				toolInput.query ||
				toolInput.url ||
				"";
		}

		// Truncate parameter for display
		if (param.length > 40) {
			param = `...${param.substring(param.length - 37)}`;
		}

		return param ? `${toolName}: ${param}` : toolName;
	}

	/**
	 * Mark an agent as completed
	 */
	completeAgent(
		toolUseId: string,
		result?: string,
	): { group: ParallelAgentGroup; allCompleted: boolean } | null {
		const group = this.getGroupForToolUseId(toolUseId);
		if (!group) return null;

		const agent = group.agents.get(toolUseId);
		if (!agent) return null;

		agent.completed = true;
		agent.result = result;
		agent.currentAction = "Done";

		// Check if all agents in the group are completed
		const allCompleted = Array.from(group.agents.values()).every(
			(a) => a.completed,
		);

		if (allCompleted) {
			console.log(
				`[ParallelTaskTracker] All agents completed in group ${group.groupId}`,
			);
		}

		return { group, allCompleted };
	}

	/**
	 * Set the ephemeral activity ID for a group
	 */
	setEphemeralActivityId(groupId: string, activityId: string): void {
		for (const groups of this.groupsBySession.values()) {
			const group = groups.find((g) => g.groupId === groupId);
			if (group) {
				group.ephemeralActivityId = activityId;
				group.ephemeralActivityPending = false; // No longer pending
				return;
			}
		}
	}

	/**
	 * Get active parallel groups for a session
	 */
	getActiveGroups(sessionId: string): ParallelAgentGroup[] {
		const groups = this.groupsBySession.get(sessionId) || [];
		return groups.filter((g) => {
			// A group is active if at least one agent is not completed
			return Array.from(g.agents.values()).some((a) => !a.completed);
		});
	}

	/**
	 * Remove a completed group
	 */
	removeGroup(sessionId: string, groupId: string): void {
		const groups = this.groupsBySession.get(sessionId);
		if (!groups) return;

		const idx = groups.findIndex((g) => g.groupId === groupId);
		if (idx >= 0) {
			const group = groups[idx]!;
			// Clean up tool_use_id lookups
			for (const toolUseId of group.agents.keys()) {
				this.toolUseIdToGroup.delete(toolUseId);
			}
			groups.splice(idx, 1);
			console.log(
				`[ParallelTaskTracker] Removed completed group ${groupId} from session ${sessionId}`,
			);
		}
	}

	/**
	 * Format the unified parallel agent view for display
	 */
	formatUnifiedView(group: ParallelAgentGroup): string {
		const agents = Array.from(group.agents.values());
		const runningCount = agents.filter((a) => !a.completed).length;
		const totalCount = agents.length;

		const lines: string[] = [];

		// Header line
		if (runningCount > 0) {
			lines.push(`● Running ${runningCount} of ${totalCount} agents...`);
		} else {
			lines.push(`✓ Completed ${totalCount} agents`);
		}

		// Agent tree
		agents.forEach((agent, index) => {
			const isLast = index === agents.length - 1;
			const prefix = isLast ? "└──" : "├──";
			const statusIcon = agent.completed ? "✓" : "◦";
			const toolInfo =
				agent.toolCount > 0 ? ` · ${agent.toolCount} tool uses` : "";

			lines.push(`${prefix} ${statusIcon} ${agent.description}${toolInfo}`);

			// Current action sub-line
			const subPrefix = isLast ? "    " : "│   ";
			lines.push(`${subPrefix}└─${agent.currentAction}`);
		});

		return lines.join("\n");
	}

	/**
	 * Clean up old/stale groups (older than 1 hour)
	 */
	cleanup(sessionId?: string): void {
		const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour

		const sessionsToClean = sessionId
			? [sessionId]
			: Array.from(this.groupsBySession.keys());

		for (const sid of sessionsToClean) {
			const groups = this.groupsBySession.get(sid);
			if (!groups) continue;

			const staleGroups = groups.filter((g) => g.createdAt < cutoff);
			for (const group of staleGroups) {
				this.removeGroup(sid, group.groupId);
			}
		}
	}

	/**
	 * Clear all tracking for a session
	 */
	clearSession(sessionId: string): void {
		const groups = this.groupsBySession.get(sessionId);
		if (groups) {
			for (const group of groups) {
				for (const toolUseId of group.agents.keys()) {
					this.toolUseIdToGroup.delete(toolUseId);
				}
			}
			this.groupsBySession.delete(sessionId);
		}
	}
}
