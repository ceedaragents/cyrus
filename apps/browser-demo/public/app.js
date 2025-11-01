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
		this.currentRunnerMode = "mock"; // 'mock' or 'claude'

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
			downloadLogBtn: document.getElementById("downloadLogBtn"),
			screenshotBtn: document.getElementById("screenshotBtn"),

			// Main content
			activitiesContainer: document.getElementById("activitiesContainer"),
			messageInput: document.getElementById("messageInput"),
			sendBtn: document.getElementById("sendBtn"),
			stopBtn: document.getElementById("stopBtn"),

			// Test controls
			toggleMockRunner: document.getElementById("toggleMockRunner"),
			toggleClaudeRunner: document.getElementById("toggleClaudeRunner"),
			createIssueBtn: document.getElementById("createIssueBtn"),
			listIssuesBtn: document.getElementById("listIssuesBtn"),
			simulateCommentBtn: document.getElementById("simulateCommentBtn"),
			viewStorageBtn: document.getElementById("viewStorageBtn"),
			loadSessionBtn: document.getElementById("loadSessionBtn"),
			clearStorageBtn: document.getElementById("clearStorageBtn"),
			scenarioSelect: document.getElementById("scenarioSelect"),
			runScenarioBtn: document.getElementById("runScenarioBtn"),

			// Modal
			infoModal: document.getElementById("infoModal"),
			modalTitle: document.getElementById("modalTitle"),
			modalBody: document.getElementById("modalBody"),
			modalClose: document.getElementById("modalClose"),
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
			case "test:response":
				this.handleTestControlResponse(message);
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

		// Download log button
		this.elements.downloadLogBtn.addEventListener("click", () => {
			this.downloadActivityLog();
		});

		// Screenshot button
		this.elements.screenshotBtn.addEventListener("click", () => {
			this.captureScreenshot();
		});

		// Runner mode toggle
		this.elements.toggleMockRunner.addEventListener("click", () => {
			this.switchRunnerMode("mock");
		});

		this.elements.toggleClaudeRunner.addEventListener("click", () => {
			this.switchRunnerMode("claude");
		});

		// Issue tracker controls
		this.elements.createIssueBtn.addEventListener("click", () => {
			this.createTestIssue();
		});

		this.elements.listIssuesBtn.addEventListener("click", () => {
			this.listAllIssues();
		});

		this.elements.simulateCommentBtn.addEventListener("click", () => {
			this.simulateUserComment();
		});

		// Session storage controls
		this.elements.viewStorageBtn.addEventListener("click", () => {
			this.viewStoredSessions();
		});

		this.elements.loadSessionBtn.addEventListener("click", () => {
			this.loadPreviousSession();
		});

		this.elements.clearStorageBtn.addEventListener("click", () => {
			this.clearAllSessions();
		});

		// Test scenario controls
		this.elements.scenarioSelect.addEventListener("change", (e) => {
			this.elements.runScenarioBtn.disabled = !e.target.value;
		});

		this.elements.runScenarioBtn.addEventListener("click", () => {
			this.runTestScenario();
		});

		// Modal controls
		this.elements.modalClose.addEventListener("click", () => {
			this.closeModal();
		});

		this.elements.infoModal.addEventListener("click", (e) => {
			if (e.target === this.elements.infoModal) {
				this.closeModal();
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

	// ========================================
	// TEST CONTROL METHODS
	// ========================================

	/**
	 * Download activity log as JSON
	 */
	downloadActivityLog() {
		const activities = Array.from(
			this.elements.activitiesContainer.querySelectorAll(".activity"),
		);

		const activityLog = activities.map((activity) => {
			const type = activity.className.split(" ")[1];
			const id = activity.getAttribute("data-activity-id");
			const content = activity.textContent.trim();
			return { id, type, content };
		});

		const logData = {
			sessionId: this.currentSessionId,
			sessionTitle: this.elements.sidebarSessionTitle.textContent,
			exportedAt: new Date().toISOString(),
			stats: this.stats,
			activities: activityLog,
		};

		const blob = new Blob([JSON.stringify(logData, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `cyrus-activity-log-${this.currentSessionId || Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);

		this.showNotification("Activity log downloaded successfully!");
	}

	/**
	 * Capture screenshot using html2canvas (if available) or browser API
	 */
	async captureScreenshot() {
		try {
			// Simple approach: notify user to use browser screenshot tools
			this.showModal(
				"Screenshot Capture",
				`<p>To capture a screenshot of the current session:</p>
				<ol>
					<li><strong>Chrome/Edge:</strong> Press Ctrl+Shift+P (Cmd+Shift+P on Mac), type "screenshot", and select "Capture full size screenshot"</li>
					<li><strong>Firefox:</strong> Right-click and select "Take a Screenshot"</li>
					<li><strong>Safari:</strong> Press Cmd+Shift+4 for selection tool</li>
				</ol>
				<p>Alternatively, use the browser's built-in DevTools screenshot feature for high-quality captures.</p>`,
			);
		} catch (error) {
			console.error("Screenshot error:", error);
			this.showNotification("Screenshot capture not available", "error");
		}
	}

	/**
	 * Switch between Mock and Claude runner modes
	 */
	switchRunnerMode(mode) {
		if (this.currentRunnerMode === mode) {
			return;
		}

		this.currentRunnerMode = mode;

		// Update UI
		if (mode === "mock") {
			this.elements.toggleMockRunner.classList.add("active");
			this.elements.toggleClaudeRunner.classList.remove("active");
		} else {
			this.elements.toggleClaudeRunner.classList.add("active");
			this.elements.toggleMockRunner.classList.remove("active");
		}

		// Send mode change to server
		this.ws.send(
			JSON.stringify({
				type: "test:switch-runner",
				mode: mode,
			}),
		);

		this.showNotification(
			`Switched to ${mode === "mock" ? "Mock" : "Claude"} Agent Runner`,
		);
	}

	/**
	 * Create a test issue
	 */
	createTestIssue() {
		const title = prompt(
			"Enter issue title:",
			"Test Issue: Implement new feature",
		);
		if (!title) return;

		const description = prompt(
			"Enter issue description:",
			"This is a test issue for demonstrating Cyrus agent capabilities.",
		);

		this.ws.send(
			JSON.stringify({
				type: "test:create-issue",
				title,
				description: description || "",
			}),
		);

		this.showNotification("Test issue created successfully!");
	}

	/**
	 * List all issues
	 */
	listAllIssues() {
		this.ws.send(
			JSON.stringify({
				type: "test:list-issues",
			}),
		);
	}

	/**
	 * Simulate a user comment
	 */
	simulateUserComment() {
		if (!this.currentSessionId) {
			this.showNotification("No active session", "error");
			return;
		}

		const comment = prompt(
			"Enter user comment:",
			"Can you add more tests to the implementation?",
		);
		if (!comment) return;

		this.ws.send(
			JSON.stringify({
				type: "test:simulate-comment",
				sessionId: this.currentSessionId,
				comment,
			}),
		);

		this.showNotification("User comment simulated!");
	}

	/**
	 * View stored sessions
	 */
	viewStoredSessions() {
		this.ws.send(
			JSON.stringify({
				type: "test:view-storage",
			}),
		);
	}

	/**
	 * Load previous session
	 */
	loadPreviousSession() {
		const sessionId = prompt(
			"Enter session ID to load:",
			this.currentSessionId || "",
		);
		if (!sessionId) return;

		this.ws.send(
			JSON.stringify({
				type: "test:load-session",
				sessionId,
			}),
		);
	}

	/**
	 * Clear all sessions from storage
	 */
	clearAllSessions() {
		if (
			!confirm(
				"Are you sure you want to clear all stored sessions? This cannot be undone.",
			)
		) {
			return;
		}

		this.ws.send(
			JSON.stringify({
				type: "test:clear-storage",
			}),
		);

		this.showNotification("All sessions cleared from storage");
	}

	/**
	 * Run a test scenario
	 */
	runTestScenario() {
		const scenario = this.elements.scenarioSelect.value;
		if (!scenario) return;

		this.ws.send(
			JSON.stringify({
				type: "test:run-scenario",
				scenario,
			}),
		);

		this.showNotification(`Running test scenario: ${scenario}`);
	}

	/**
	 * Show modal with title and content
	 */
	showModal(title, content) {
		this.elements.modalTitle.textContent = title;
		this.elements.modalBody.innerHTML = content;
		this.elements.infoModal.classList.add("open");
	}

	/**
	 * Close modal
	 */
	closeModal() {
		this.elements.infoModal.classList.remove("open");
	}

	/**
	 * Show notification (using browser native or fallback to alert)
	 */
	showNotification(message, type = "success") {
		// Create a temporary notification element
		const notification = document.createElement("div");
		notification.style.cssText = `
			position: fixed;
			top: 24px;
			right: 24px;
			padding: 16px 24px;
			background: ${type === "error" ? "var(--accent-red)" : "var(--accent-green)"};
			color: white;
			border-radius: 8px;
			box-shadow: var(--shadow-lg);
			z-index: 10000;
			font-size: 14px;
			font-weight: 600;
			animation: slide-in-right 0.3s ease-out;
		`;
		notification.textContent = message;

		document.body.appendChild(notification);

		setTimeout(() => {
			notification.style.animation = "slide-out-right 0.3s ease-in";
			setTimeout(() => notification.remove(), 300);
		}, 3000);
	}

	/**
	 * Handle test control responses from server
	 */
	handleTestControlResponse(message) {
		switch (message.action) {
			case "list-issues":
				this.showModal(
					"All Issues",
					`<pre>${JSON.stringify(message.data, null, 2)}</pre>`,
				);
				break;
			case "view-storage":
				this.showModal(
					"Stored Sessions",
					`<pre>${JSON.stringify(message.data, null, 2)}</pre>`,
				);
				break;
			case "error":
				this.showNotification(message.message, "error");
				break;
			case "success":
				this.showNotification(message.message, "success");
				break;
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
