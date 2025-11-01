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
		const { toolName, input, output } = this.parseToolContent(activity.content);

		div.innerHTML = `
            <div class="activity-header" onclick="window.cyrusClient.toggleToolOutput('${activity.id}')">
                <div class="activity-title">
                    <span class="tool-icon">⚙</span>
                    <strong class="tool-name">${this.escapeHtml(toolName)}</strong>
                </div>
                <button class="expand-btn" id="expand-${activity.id}">▼</button>
            </div>
            <time class="activity-timestamp">${timestamp}</time>
            <div class="activity-input">
                <code class="language-bash">${this.escapeHtml(input)}</code>
            </div>
            <div class="activity-output collapsed" id="output-${activity.id}">
                <code class="language-bash">${this.escapeHtml(output)}</code>
            </div>
            <button class="copy-btn" onclick="window.cyrusClient.copyCode('${activity.id}', \`${this.escapeForTemplate(input)}\`)">
                Copy
            </button>
        `;

		// Apply syntax highlighting
		setTimeout(() => {
			const codeBlocks = div.querySelectorAll("code");
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
	 * Parse tool call content to extract tool name, input, and output
	 */
	parseToolContent(content) {
		const lines = content.split("\n");
		let toolName = "Tool";
		let input = "";
		let output = "";

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
				currentSection = "input";
				input = line.substring(10).trim();
			} else if (currentSection === "input" && line.trim()) {
				input += (input ? "\n" : "") + line;
			} else if (currentSection === "output" && line.trim()) {
				output += (output ? "\n" : "") + line;
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
	 * Copy code to clipboard
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

		// Enter key in input
		this.elements.messageInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
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

	shareSession() {
		if (navigator.share) {
			navigator.share({
				title: "Cyrus Session",
				text: `Check out my Cyrus agent session: ${this.elements.sidebarSessionTitle.textContent}`,
				url: window.location.href,
			});
		} else {
			// Fallback: copy URL to clipboard
			navigator.clipboard.writeText(window.location.href);
			alert("Session URL copied to clipboard!");
		}
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
