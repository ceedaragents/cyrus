// Browser client for Cyrus demo with sophisticated activity rendering
class CyrusDemoClient {
	constructor() {
		this.ws = null;
		this.currentSessionId = null;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 5;
		this.renderedActivityIds = new Set();
		this.sessionStartTime = null;
		this.durationInterval = null;

		// Statistics counters
		this.stats = {
			thoughts: 0,
			toolCalls: 0,
			messages: 0,
		};

		this.elements = {
			// Header
			connectionStatus: document.getElementById("connectionStatus"),

			// Sidebar
			sidebarSessionTitle: document.getElementById("sidebarSessionTitle"),
			sidebarSessionId: document.getElementById("sidebarSessionId"),
			sidebarSessionState: document.getElementById("sidebarSessionState"),
			sidebarToggle: document.getElementById("sidebarToggle"),
			sidebar: document.getElementById("sidebar"),
			statThoughts: document.getElementById("statThoughts"),
			statToolCalls: document.getElementById("statToolCalls"),
			statMessages: document.getElementById("statMessages"),
			statDuration: document.getElementById("statDuration"),
			timelineScrubber: document.getElementById("timelineScrubber"),
			exportBtn: document.getElementById("exportBtn"),
			shareBtn: document.getElementById("shareBtn"),

			// Main content
			activitiesContainer: document.getElementById("activitiesContainer"),
			messageInput: document.getElementById("messageInput"),
			sendBtn: document.getElementById("sendBtn"),
			stopBtn: document.getElementById("stopBtn"),
		};

		this.connect();
		this.setupEventListeners();
	}

	connect() {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}`;

		console.log("Connecting to WebSocket:", wsUrl);
		this.ws = new WebSocket(wsUrl);

		this.ws.onopen = () => {
			console.log("WebSocket connected");
			this.reconnectAttempts = 0;
			this.updateConnectionStatus(true);
		};

		this.ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				this.handleMessage(message);
			} catch (error) {
				console.error("Failed to parse message:", error);
			}
		};

		this.ws.onclose = () => {
			console.log("WebSocket disconnected");
			this.updateConnectionStatus(false);
			this.attemptReconnect();
		};

		this.ws.onerror = (error) => {
			console.error("WebSocket error:", error);
		};
	}

	attemptReconnect() {
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++;
			const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
			console.log(
				`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
			);
			setTimeout(() => this.connect(), delay);
		} else {
			console.error("Max reconnection attempts reached");
			this.elements.connectionStatus.textContent =
				"Connection failed - refresh page to retry";
		}
	}

	updateConnectionStatus(connected) {
		this.elements.connectionStatus.className = `connection-status ${connected ? "connected" : "disconnected"}`;
		this.elements.connectionStatus.textContent = connected
			? "Connected"
			: "Disconnected";
	}

	handleMessage(message) {
		console.log("Received message:", message);

		switch (message.type) {
			case "session:update":
				this.updateSession(message.data);
				break;
			case "activity:new":
				this.addActivity(message.sessionId, message.activity);
				break;
			default:
				console.warn("Unknown message type:", message.type);
		}
	}

	updateSession(sessionState) {
		// If this is a new session, clear the rendered activity IDs and stats
		if (this.currentSessionId !== sessionState.session.id) {
			this.renderedActivityIds.clear();
			this.resetStats();
			this.sessionStartTime = new Date(sessionState.session.startedAt);
			this.startDurationTimer();
		}

		// Update current session ID
		this.currentSessionId = sessionState.session.id;

		// Update session info in sidebar
		this.elements.sidebarSessionTitle.textContent =
			sessionState.session.issueTitle;
		this.elements.sidebarSessionId.textContent = sessionState.session.issueId;

		// Update session state badge
		this.updateSessionStateBadge(sessionState.status);

		// Update activities (only render new ones)
		this.renderActivities(sessionState.activities);

		// Enable/disable input based on session status
		const isRunning = sessionState.status === "running";
		this.elements.messageInput.disabled = !isRunning;
		this.elements.sendBtn.disabled = !isRunning;
		this.elements.stopBtn.disabled = !isRunning;
	}

	updateSessionStateBadge(status) {
		const badge = this.elements.sidebarSessionState;
		badge.className = `session-state-badge ${status}`;

		const statusText =
			{
				running: "Thinking",
				complete: "Complete",
				error: "Error",
			}[status] || "Unknown";

		badge.textContent = statusText;
	}

	resetStats() {
		this.stats = { thoughts: 0, toolCalls: 0, messages: 0 };
		this.updateStatsDisplay();
	}

	updateStatsDisplay() {
		this.elements.statThoughts.textContent = this.stats.thoughts;
		this.elements.statToolCalls.textContent = this.stats.toolCalls;
		this.elements.statMessages.textContent = this.stats.messages;
	}

	startDurationTimer() {
		if (this.durationInterval) {
			clearInterval(this.durationInterval);
		}

		this.durationInterval = setInterval(() => {
			if (this.sessionStartTime) {
				const duration = Math.floor(
					(Date.now() - this.sessionStartTime) / 1000,
				);
				this.elements.statDuration.textContent = this.formatDuration(duration);
			}
		}, 1000);
	}

	formatDuration(seconds) {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		if (mins > 0) {
			return `${mins}m ${secs}s`;
		}
		return `${secs}s`;
	}

	renderActivities(activities) {
		if (activities.length === 0) {
			this.elements.activitiesContainer.innerHTML = `
                <div class="empty-state">
                    No activities yet. Waiting for agent to start...
                </div>
            `;
			return;
		}

		// Remove empty state if present
		const emptyState =
			this.elements.activitiesContainer.querySelector(".empty-state");
		if (emptyState) {
			emptyState.remove();
		}

		// Only render activities we haven't seen before
		for (const activity of activities) {
			this.renderSingleActivity(activity);
		}
	}

	/**
	 * Determine semantic activity type from raw activity data
	 */
	determineSemanticType(activity) {
		const type = activity.type.toLowerCase();

		// Map activity types to semantic types
		if (type.includes("thought") || type === "text") {
			return "thought";
		}
		if (type.includes("tool") || type === "tool-use") {
			return "tool-call";
		}
		if (type === "complete") {
			return "result";
		}
		if (type === "error") {
			return "result";
		}
		if (type === "session-start") {
			return "system-evt";
		}
		if (type.includes("user") || type.includes("message")) {
			return "user-msg";
		}

		// Default fallback
		return "thought";
	}

	/**
	 * Render a single activity with appropriate semantic type
	 */
	renderSingleActivity(activity) {
		// Skip if already rendered
		if (this.renderedActivityIds.has(activity.id)) {
			return;
		}

		// Mark as rendered
		this.renderedActivityIds.add(activity.id);

		// Remove empty state if present
		const emptyState =
			this.elements.activitiesContainer.querySelector(".empty-state");
		if (emptyState) {
			emptyState.remove();
		}

		// Determine semantic type
		const semanticType = this.determineSemanticType(activity);

		// Create activity element based on semantic type
		let activityElement;
		switch (semanticType) {
			case "thought":
				activityElement = this.createThoughtActivity(activity);
				this.stats.thoughts++;
				break;
			case "tool-call":
				activityElement = this.createToolCallActivity(activity);
				this.stats.toolCalls++;
				break;
			case "result":
				activityElement = this.createResultActivity(activity);
				break;
			case "user-msg":
				activityElement = this.createUserMessageActivity(activity);
				this.stats.messages++;
				break;
			case "system-evt":
				activityElement = this.createSystemEventActivity(activity);
				break;
			default:
				activityElement = this.createThoughtActivity(activity);
		}

		// Update stats display
		this.updateStatsDisplay();

		// Add timeline dot
		this.addTimelineDot(activity.id);

		// Append to container
		this.elements.activitiesContainer.appendChild(activityElement);

		// Auto-scroll after adding activity
		this.scrollToBottom();
	}

	/**
	 * Create THOUGHT activity (minimal, italic)
	 */
	createThoughtActivity(activity) {
		const div = document.createElement("div");
		div.className = "activity thought";
		div.setAttribute("data-activity-id", activity.id);
		div.id = `activity-${activity.id}`;

		const timestamp = this.formatTimestamp(activity.timestamp);
		div.innerHTML = `
            <div class="activity-meta">
                <span class="activity-icon">~</span>
                <time class="activity-timestamp">${timestamp}</time>
            </div>
            <div class="activity-content">${this.escapeHtml(activity.content)}</div>
        `;

		return div;
	}

	/**
	 * Create TOOL_CALL activity (prominent card with expand/collapse)
	 */
	createToolCallActivity(activity) {
		const div = document.createElement("div");
		div.className = "activity tool-call";
		div.setAttribute("data-activity-id", activity.id);
		div.id = `activity-${activity.id}`;

		const timestamp = this.formatTimestamp(activity.timestamp);

		// Parse tool name and input/output from content
		const { toolName, input, output, params } = this.parseToolContent(
			activity.content,
		);

		// Render based on tool type
		const toolRenderer = this.getToolRenderer(toolName);
		const renderedContent = toolRenderer(
			toolName,
			input,
			output,
			params,
			activity.id,
		);

		div.innerHTML = `
            <div class="activity-header" onclick="window.cyrusClient.toggleToolOutput('${activity.id}')">
                <div class="activity-title">
                    <span class="tool-icon">${this.getToolIcon(toolName)}</span>
                    <strong class="tool-name">${this.escapeHtml(toolName)}</strong>
                </div>
                <button class="expand-btn" id="expand-${activity.id}" aria-label="Expand output">▼</button>
            </div>
            <time class="activity-timestamp">${timestamp}</time>
            ${renderedContent}
        `;

		// Apply syntax highlighting
		setTimeout(() => {
			const codeBlocks = div.querySelectorAll("pre code");
			codeBlocks.forEach((block) => {
				if (window.Prism) {
					window.Prism.highlightElement(block);
				}
			});
		}, 10);

		return div;
	}

	/**
	 * Create RESULT activity (success/error indicator)
	 */
	createResultActivity(activity) {
		const div = document.createElement("div");
		const isError = activity.type.toLowerCase().includes("error");
		div.className = `activity result ${isError ? "error" : "success"}`;
		div.setAttribute("data-activity-id", activity.id);
		div.id = `activity-${activity.id}`;

		const icon = isError ? "✗" : "✓";

		div.innerHTML = `
            <span class="result-icon">${icon}</span>
            <span class="result-message">${this.escapeHtml(activity.content)}</span>
        `;

		return div;
	}

	/**
	 * Create USER_MSG activity (user input)
	 */
	createUserMessageActivity(activity) {
		const div = document.createElement("div");
		div.className = "activity user-msg";
		div.setAttribute("data-activity-id", activity.id);
		div.id = `activity-${activity.id}`;

		const timestamp = this.formatTimestamp(activity.timestamp);

		div.innerHTML = `
            <div class="activity-header">
                <div class="user-avatar">U</div>
                <span class="user-name">User</span>
                <time class="activity-timestamp">${timestamp}</time>
            </div>
            <div class="activity-content">${this.escapeHtml(activity.content)}</div>
        `;

		return div;
	}

	/**
	 * Create SYSTEM_EVT activity (timeline marker)
	 */
	createSystemEventActivity(activity) {
		const div = document.createElement("div");
		div.className = "activity system-evt";
		div.setAttribute("data-activity-id", activity.id);
		div.id = `activity-${activity.id}`;

		div.innerHTML = `
            <div class="system-dot"></div>
            <span class="system-text">${this.escapeHtml(activity.content)}</span>
        `;

		return div;
	}

	/**
	 * Get appropriate icon for tool type
	 */
	getToolIcon(toolName) {
		const iconMap = {
			Read: "📄",
			Edit: "✏️",
			Write: "📝",
			Bash: "⚡",
			Glob: "📁",
			Grep: "🔍",
			TodoWrite: "✅",
			TodoRead: "📋",
			Task: "🤖",
			WebFetch: "🌐",
			WebSearch: "🔎",
		};
		return iconMap[toolName] || "⚙️";
	}

	/**
	 * Get renderer function for specific tool type
	 */
	getToolRenderer(toolName) {
		const renderers = {
			Read: this.renderReadTool.bind(this),
			Edit: this.renderEditTool.bind(this),
			Write: this.renderWriteTool.bind(this),
			Bash: this.renderBashTool.bind(this),
			Glob: this.renderGlobTool.bind(this),
			Grep: this.renderGrepTool.bind(this),
			TodoWrite: this.renderTodoWriteTool.bind(this),
		};
		return renderers[toolName] || this.renderGenericTool.bind(this);
	}

	/**
	 * Detect file language for syntax highlighting
	 */
	detectLanguage(filePath) {
		if (!filePath) return "plaintext";
		const ext = filePath.split(".").pop().toLowerCase();
		const langMap = {
			js: "javascript",
			mjs: "javascript",
			jsx: "jsx",
			ts: "typescript",
			tsx: "tsx",
			json: "json",
			html: "markup",
			xml: "markup",
			css: "css",
			scss: "scss",
			py: "python",
			rb: "ruby",
			go: "go",
			rs: "rust",
			java: "java",
			c: "c",
			cpp: "cpp",
			sh: "bash",
			bash: "bash",
			zsh: "bash",
			md: "markdown",
			yaml: "yaml",
			yml: "yaml",
			toml: "toml",
			sql: "sql",
		};
		return langMap[ext] || "plaintext";
	}

	/**
	 * Render Read tool (file contents with syntax highlighting)
	 */
	renderReadTool(_toolName, input, output, params, activityId) {
		const filePath = params.file_path || input;
		const language = this.detectLanguage(filePath);
		const hasLineNumbers = output.includes("→");

		return `
            <div class="tool-params">
                <span class="param-label">File:</span>
                <code class="param-value">${this.escapeHtml(filePath)}</code>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">File Contents</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy</button>
                </div>
                <pre class="code-block ${hasLineNumbers ? "with-line-numbers" : ""}"><code class="language-${language}">${this.escapeHtml(output)}</code></pre>
            </div>
        `;
	}

	/**
	 * Render Edit tool (diff display)
	 */
	renderEditTool(_toolName, _input, output, params, activityId) {
		const filePath = params.file_path || "file";
		const oldString = params.old_string || "";
		const newString = params.new_string || "";

		return `
            <div class="tool-params">
                <span class="param-label">File:</span>
                <code class="param-value">${this.escapeHtml(filePath)}</code>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">Changes</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy Diff</button>
                </div>
                <div class="diff-view">
                    <div class="diff-section removed">
                        <div class="diff-label">− Removed</div>
                        <pre><code class="language-diff">${this.escapeHtml(oldString)}</code></pre>
                    </div>
                    <div class="diff-section added">
                        <div class="diff-label">+ Added</div>
                        <pre><code class="language-diff">${this.escapeHtml(newString)}</code></pre>
                    </div>
                </div>
                ${output !== "(no output)" ? `<div class="edit-result">${this.escapeHtml(output)}</div>` : ""}
            </div>
        `;
	}

	/**
	 * Render Write tool (file creation)
	 */
	renderWriteTool(_toolName, input, output, params, activityId) {
		const filePath = params.file_path || input;
		const language = this.detectLanguage(filePath);
		const content = params.content || output;

		return `
            <div class="tool-params">
                <span class="param-label">Created:</span>
                <code class="param-value">${this.escapeHtml(filePath)}</code>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">File Contents</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy</button>
                </div>
                <pre class="code-block"><code class="language-${language}">${this.escapeHtml(content)}</code></pre>
            </div>
        `;
	}

	/**
	 * Render Bash tool (terminal-style output)
	 */
	renderBashTool(_toolName, input, output, params, activityId) {
		const command = params.command || input;

		return `
            <div class="tool-params bash-command">
                <span class="param-label">$</span>
                <code class="param-value">${this.escapeHtml(command)}</code>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">Output</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy</button>
                </div>
                <pre class="terminal-output"><code>${this.escapeHtml(output)}</code></pre>
            </div>
        `;
	}

	/**
	 * Render Glob tool (file list)
	 */
	renderGlobTool(_toolName, input, output, params, activityId) {
		const pattern = params.pattern || input;
		const files = output
			.split("\n")
			.filter((line) => line.trim())
			.filter((line) => !line.includes("(no output)"));
		const fileCount = files.length;

		return `
            <div class="tool-params">
                <span class="param-label">Pattern:</span>
                <code class="param-value">${this.escapeHtml(pattern)}</code>
                <span class="file-count">${fileCount} file${fileCount !== 1 ? "s" : ""}</span>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">Matched Files</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy List</button>
                </div>
                <ul class="file-list">
                    ${files.map((file) => `<li class="file-item"><code>${this.escapeHtml(file)}</code></li>`).join("")}
                </ul>
            </div>
        `;
	}

	/**
	 * Render Grep tool (search results)
	 */
	renderGrepTool(_toolName, input, output, params, activityId) {
		const pattern = params.pattern || input;
		const matches = output
			.split("\n")
			.filter((line) => line.trim())
			.filter((line) => !line.includes("(no output)"));
		const matchCount = matches.length;

		return `
            <div class="tool-params">
                <span class="param-label">Pattern:</span>
                <code class="param-value">${this.escapeHtml(pattern)}</code>
                <span class="file-count">${matchCount} match${matchCount !== 1 ? "es" : ""}</span>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">Search Results</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy Results</button>
                </div>
                <pre class="search-results"><code>${this.escapeHtml(output)}</code></pre>
            </div>
        `;
	}

	/**
	 * Render TodoWrite tool (task list)
	 */
	renderTodoWriteTool(_toolName, input, output, _params, activityId) {
		// Try to parse todos from input or output
		let todos = [];
		try {
			const todoData = JSON.parse(input);
			if (todoData.todos && Array.isArray(todoData.todos)) {
				todos = todoData.todos;
			}
		} catch {
			// If parsing fails, show raw output
		}

		const todoHtml =
			todos.length > 0
				? todos
						.map((todo) => {
							const statusIcon =
								{
									completed: "✓",
									in_progress: "⟳",
									pending: "○",
								}[todo.status] || "○";
							const statusClass = todo.status || "pending";
							return `
                        <li class="todo-item ${statusClass}">
                            <span class="todo-status">${statusIcon}</span>
                            <span class="todo-content">${this.escapeHtml(todo.content || todo.activeForm || "")}</span>
                        </li>
                    `;
						})
						.join("")
				: `<pre><code>${this.escapeHtml(output)}</code></pre>`;

		return `
            <div class="tool-params">
                <span class="param-label">Tasks:</span>
                <span class="file-count">${todos.length} todo${todos.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">Task List</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy</button>
                </div>
                ${todos.length > 0 ? `<ul class="todo-list">${todoHtml}</ul>` : todoHtml}
            </div>
        `;
	}

	/**
	 * Render generic tool (fallback for unknown tools)
	 */
	renderGenericTool(_toolName, input, output, _params, activityId) {
		return `
            <div class="tool-params">
                <code class="param-value">${this.escapeHtml(input)}</code>
            </div>
            <div class="activity-output collapsed" id="output-${activityId}">
                <div class="output-header">
                    <span class="output-label">Output</span>
                    <button class="copy-output-btn" onclick="window.cyrusClient.copyOutput('${activityId}')">Copy</button>
                </div>
                <pre class="code-block"><code>${this.escapeHtml(output)}</code></pre>
            </div>
        `;
	}

	/**
	 * Parse tool call content to extract tool name, input, output, and parameters
	 */
	parseToolContent(content) {
		const lines = content.split("\n");
		let toolName = "Tool";
		let input = "";
		let output = "";
		const params = {};

		let currentSection = null;

		for (const line of lines) {
			if (line.startsWith("Tool:")) {
				toolName = line.substring(5).trim();
			} else if (line.startsWith("Input:")) {
				currentSection = "input";
				const inputText = line.substring(6).trim();
				if (inputText) {
					input = inputText;
				}
			} else if (line.startsWith("Result:")) {
				currentSection = "output";
				const outputText = line.substring(7).trim();
				if (outputText) {
					output = outputText;
				}
			} else if (line.startsWith("Action:")) {
				toolName = line.substring(7).trim();
			} else if (line.startsWith("Parameter:")) {
				currentSection = "params";
				const paramLine = line.substring(10).trim();
				// Try to parse as JSON
				try {
					const paramData = JSON.parse(paramLine);
					Object.assign(params, paramData);
				} catch {
					// If not JSON, just store as-is
					params.raw = paramLine;
				}
			} else if (line.includes(":") && currentSection === null) {
				// Try to extract parameters like "file_path: /path/to/file"
				const [key, ...valueParts] = line.split(":");
				if (key && valueParts.length > 0) {
					const cleanKey = key.trim().toLowerCase();
					const value = valueParts.join(":").trim();
					if (
						[
							"file_path",
							"pattern",
							"command",
							"old_string",
							"new_string",
							"selector",
							"url",
						].includes(cleanKey)
					) {
						params[cleanKey] = value;
					}
				}
			} else if (currentSection === "input" && line.trim()) {
				input += (input ? "\n" : "") + line;
			} else if (currentSection === "output" && line.trim()) {
				output += (output ? "\n" : "") + line;
			} else if (currentSection === "params" && line.trim()) {
				// Continue reading parameter data
				try {
					const paramData = JSON.parse(line.trim());
					Object.assign(params, paramData);
				} catch {
					// Ignore parse errors
				}
			}
		}

		// If no explicit sections, treat entire content as input
		if (!input && !output) {
			input = content;
			output = "(no output)";
		}

		return {
			toolName,
			input: input || "(empty)",
			output: output || "(no output)",
			params,
		};
	}

	/**
	 * Toggle tool call output visibility
	 */
	toggleToolOutput(activityId) {
		const output = document.getElementById(`output-${activityId}`);
		const expandBtn = document.getElementById(`expand-${activityId}`);

		if (output && expandBtn) {
			const isCollapsed = output.classList.contains("collapsed");
			output.classList.toggle("collapsed");
			expandBtn.textContent = isCollapsed ? "▲" : "▼";
		}
	}

	/**
	 * Copy output content to clipboard
	 */
	async copyOutput(activityId) {
		try {
			const outputElement = document.getElementById(`output-${activityId}`);
			if (!outputElement) return;

			// Extract text content from the output
			const codeBlocks = outputElement.querySelectorAll("code");
			const textContent =
				codeBlocks.length > 0
					? Array.from(codeBlocks)
							.map((block) => block.textContent)
							.join("\n")
					: outputElement.textContent;

			await navigator.clipboard.writeText(textContent);

			// Visual feedback
			const btn = event.target;
			const originalText = btn.textContent;
			btn.classList.add("copied");
			btn.textContent = "Copied!";

			setTimeout(() => {
				btn.classList.remove("copied");
				btn.textContent = originalText;
			}, 2000);
		} catch (error) {
			console.error("Failed to copy:", error);
		}
	}

	/**
	 * Copy code to clipboard (legacy function, kept for compatibility)
	 */
	async copyCode(_activityId, code) {
		try {
			await navigator.clipboard.writeText(code);

			// Visual feedback
			const btn = event.target;
			const originalText = btn.textContent;
			btn.classList.add("copied");
			btn.textContent = "Copied!";

			setTimeout(() => {
				btn.classList.remove("copied");
				btn.textContent = originalText;
			}, 2000);
		} catch (error) {
			console.error("Failed to copy:", error);
		}
	}

	/**
	 * Add a timeline dot
	 */
	addTimelineDot(activityId) {
		const dot = document.createElement("div");
		dot.className = "timeline-dot";
		dot.setAttribute("data-activity-id", activityId);
		dot.addEventListener("click", () => this.scrollToActivity(activityId));
		this.elements.timelineScrubber.appendChild(dot);
	}

	/**
	 * Scroll to a specific activity
	 */
	scrollToActivity(activityId) {
		const activity = document.getElementById(`activity-${activityId}`);
		if (activity) {
			activity.scrollIntoView({ behavior: "smooth", block: "center" });
			activity.classList.add("highlight");
			setTimeout(() => activity.classList.remove("highlight"), 2000);

			// Update active timeline dot
			const dots =
				this.elements.timelineScrubber.querySelectorAll(".timeline-dot");
			dots.forEach((dot) => {
				dot.classList.remove("active");
			});
			const targetDot = this.elements.timelineScrubber.querySelector(
				`[data-activity-id="${activityId}"]`,
			);
			if (targetDot) {
				targetDot.classList.add("active");
			}
		}
	}

	/**
	 * Add a new activity (called when receiving activity:new message)
	 */
	addActivity(sessionId, activity) {
		// Update current session ID if needed
		if (!this.currentSessionId) {
			this.currentSessionId = sessionId;
		}

		// Only add activities for the current session
		if (this.currentSessionId === sessionId) {
			this.renderSingleActivity(activity);
		}
	}

	formatTimestamp(timestamp) {
		const date = new Date(timestamp);
		const now = new Date();
		const diffSeconds = Math.floor((now - date) / 1000);

		if (diffSeconds < 60) {
			return "just now";
		} else if (diffSeconds < 3600) {
			const mins = Math.floor(diffSeconds / 60);
			return `${mins}m ago`;
		} else {
			return date.toLocaleTimeString();
		}
	}

	escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}

	escapeForTemplate(text) {
		return text.replace(/`/g, "\\`").replace(/\$/g, "\\$");
	}

	scrollToBottom() {
		this.elements.activitiesContainer.scrollTop =
			this.elements.activitiesContainer.scrollHeight;
	}

	setupEventListeners() {
		// Send button
		this.elements.sendBtn.addEventListener("click", () => {
			this.sendMessage();
		});

		// Enter key in input (regular Enter)
		this.elements.messageInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				this.sendMessage();
			}
		});

		// Cmd+Enter / Ctrl+Enter keyboard shortcut
		this.elements.messageInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Stop button
		this.elements.stopBtn.addEventListener("click", () => {
			this.sendStop();
		});

		// Sidebar toggle (mobile)
		this.elements.sidebarToggle.addEventListener("click", () => {
			this.elements.sidebar.classList.toggle("open");
		});

		// Export button
		this.elements.exportBtn.addEventListener("click", () => {
			this.exportSession();
		});

		// Share button
		this.elements.shareBtn.addEventListener("click", () => {
			this.shareSession();
		});

		// Close modal when clicking overlay
		const modalOverlay = document.getElementById("modalOverlay");
		if (modalOverlay) {
			modalOverlay.addEventListener("click", (e) => {
				if (e.target === modalOverlay) {
					this.hideModal();
				}
			});
		}

		// Escape key to close modal
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.hideModal();
			}
		});
	}

	sendMessage() {
		const message = this.elements.messageInput.value.trim();
		if (!message || !this.currentSessionId) {
			return;
		}

		console.log("Sending message:", message);

		this.ws.send(
			JSON.stringify({
				type: "user:message",
				sessionId: this.currentSessionId,
				message: message,
			}),
		);

		this.elements.messageInput.value = "";
	}

	sendStop() {
		if (!this.currentSessionId) {
			return;
		}

		console.log("Sending stop signal");

		this.ws.send(
			JSON.stringify({
				type: "user:stop",
				sessionId: this.currentSessionId,
				reason: "User stopped via browser UI",
			}),
		);
	}

	exportSession() {
		// Collect all activities as text
		const activities = Array.from(
			this.elements.activitiesContainer.querySelectorAll(".activity"),
		);
		const sessionText = activities
			.map((activity) => {
				const type = activity.className.split(" ")[1];
				const content = activity.textContent.trim();
				return `[${type.toUpperCase()}] ${content}`;
			})
			.join("\n\n");

		const blob = new Blob([sessionText], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `cyrus-session-${this.currentSessionId || "export"}.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async shareSession() {
		if (navigator.share) {
			try {
				await navigator.share({
					title: "Cyrus Session",
					text: `Check out my Cyrus agent session: ${this.elements.sidebarSessionTitle.textContent}`,
					url: window.location.href,
				});
			} catch (error) {
				// User cancelled share - that's okay, do nothing
				if (error.name !== "AbortError") {
					console.error("Error sharing:", error);
				}
			}
		} else {
			// Fallback: copy URL to clipboard
			await navigator.clipboard.writeText(window.location.href);
			this.showNotification("Success", "Session URL copied to clipboard!");
		}
	}

	/**
	 * Show a notification modal (replaces alert)
	 */
	showNotification(title, message) {
		const modalOverlay = document.getElementById("modalOverlay");
		const modalTitle = document.getElementById("modalTitle");
		const modalMessage = document.getElementById("modalMessage");
		const modalInput = document.getElementById("modalInput");
		const modalActions = document.getElementById("modalActions");

		modalTitle.textContent = title;
		modalMessage.textContent = message;
		modalInput.style.display = "none";

		// Clear previous buttons
		modalActions.innerHTML = "";

		// Add OK button
		const okBtn = document.createElement("button");
		okBtn.className = "modal-btn modal-btn-primary";
		okBtn.textContent = "OK";
		okBtn.onclick = () => this.hideModal();
		modalActions.appendChild(okBtn);

		// Show modal
		modalOverlay.classList.add("visible");

		// Focus OK button
		setTimeout(() => okBtn.focus(), 100);
	}

	/**
	 * Show a confirmation modal (replaces confirm)
	 */
	showConfirm(title, message, onConfirm, onCancel = null) {
		const modalOverlay = document.getElementById("modalOverlay");
		const modalTitle = document.getElementById("modalTitle");
		const modalMessage = document.getElementById("modalMessage");
		const modalInput = document.getElementById("modalInput");
		const modalActions = document.getElementById("modalActions");

		modalTitle.textContent = title;
		modalMessage.textContent = message;
		modalInput.style.display = "none";

		// Clear previous buttons
		modalActions.innerHTML = "";

		// Add Cancel button
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "modal-btn modal-btn-cancel";
		cancelBtn.textContent = "Cancel";
		cancelBtn.onclick = () => {
			this.hideModal();
			if (onCancel) onCancel();
		};
		modalActions.appendChild(cancelBtn);

		// Add Confirm button
		const confirmBtn = document.createElement("button");
		confirmBtn.className = "modal-btn modal-btn-danger";
		confirmBtn.textContent = "Confirm";
		confirmBtn.onclick = () => {
			this.hideModal();
			onConfirm();
		};
		modalActions.appendChild(confirmBtn);

		// Show modal
		modalOverlay.classList.add("visible");

		// Focus confirm button
		setTimeout(() => confirmBtn.focus(), 100);
	}

	/**
	 * Show a prompt modal (replaces prompt)
	 */
	showPrompt(title, message, defaultValue = "", onSubmit, onCancel = null) {
		const modalOverlay = document.getElementById("modalOverlay");
		const modalTitle = document.getElementById("modalTitle");
		const modalMessage = document.getElementById("modalMessage");
		const modalInput = document.getElementById("modalInput");
		const modalActions = document.getElementById("modalActions");

		modalTitle.textContent = title;
		modalMessage.textContent = message;
		modalInput.style.display = "block";
		modalInput.value = defaultValue;

		// Clear previous buttons
		modalActions.innerHTML = "";

		// Add Cancel button
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "modal-btn modal-btn-cancel";
		cancelBtn.textContent = "Cancel";
		cancelBtn.onclick = () => {
			this.hideModal();
			if (onCancel) onCancel();
		};
		modalActions.appendChild(cancelBtn);

		// Add Submit button
		const submitBtn = document.createElement("button");
		submitBtn.className = "modal-btn modal-btn-primary";
		submitBtn.textContent = "Submit";
		submitBtn.onclick = () => {
			const value = modalInput.value.trim();
			this.hideModal();
			onSubmit(value);
		};
		modalActions.appendChild(submitBtn);

		// Show modal
		modalOverlay.classList.add("visible");

		// Focus input and select text
		setTimeout(() => {
			modalInput.focus();
			modalInput.select();
		}, 100);

		// Handle Enter key in input
		const enterHandler = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				const value = modalInput.value.trim();
				this.hideModal();
				onSubmit(value);
			}
		};
		modalInput.addEventListener("keypress", enterHandler);

		// Store handler for cleanup
		modalInput._enterHandler = enterHandler;
	}

	/**
	 * Hide the modal
	 */
	hideModal() {
		const modalOverlay = document.getElementById("modalOverlay");
		const modalInput = document.getElementById("modalInput");

		modalOverlay.classList.remove("visible");

		// Clean up event listener if it exists
		if (modalInput._enterHandler) {
			modalInput.removeEventListener("keypress", modalInput._enterHandler);
			delete modalInput._enterHandler;
		}

		// Clear input value
		modalInput.value = "";
	}
}

// Initialize the client when DOM is ready and expose globally for event handlers
window.cyrusClient = null;

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		window.cyrusClient = new CyrusDemoClient();
	});
} else {
	window.cyrusClient = new CyrusDemoClient();
}
