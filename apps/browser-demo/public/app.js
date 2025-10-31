// Browser client for Cyrus demo
class CyrusDemoClient {
	constructor() {
		this.ws = null;
		this.currentSessionId = null;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 5;

		this.elements = {
			connectionStatus: document.getElementById("connectionStatus"),
			sessionStatus: document.getElementById("sessionStatus"),
			sessionTitle: document.getElementById("sessionTitle"),
			sessionId: document.getElementById("sessionId"),
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
			? "● Connected"
			: "○ Disconnected";
	}

	handleMessage(message) {
		console.log("Received message:", message);

		switch (message.type) {
			case "session:update":
				this.updateSession(message.data);
				break;
			default:
				console.warn("Unknown message type:", message.type);
		}
	}

	updateSession(sessionState) {
		console.log("Updating session:", sessionState);

		// Update current session ID
		this.currentSessionId = sessionState.session.id;

		// Update session header
		this.elements.sessionTitle.textContent = sessionState.session.issueTitle;
		this.elements.sessionId.textContent = `(${sessionState.session.issueId})`;

		// Update session status
		this.elements.sessionStatus.className = `session-status ${sessionState.status}`;

		// Update activities
		this.renderActivities(sessionState.activities);

		// Enable/disable input based on session status
		const isRunning = sessionState.status === "running";
		this.elements.messageInput.disabled = !isRunning;
		this.elements.sendBtn.disabled = !isRunning;
		this.elements.stopBtn.disabled = !isRunning;

		// Auto-scroll to bottom
		this.scrollToBottom();
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

		this.elements.activitiesContainer.innerHTML = activities
			.map((activity) => {
				const timestamp = new Date(activity.timestamp).toLocaleTimeString();
				return `
                <div class="activity-item">
                    <div class="activity-header">
                        <span class="activity-timestamp">[${timestamp}]</span>
                        <span class="activity-icon">${activity.icon}</span>
                        <span class="activity-type ${activity.type}">${activity.type}</span>
                    </div>
                    <div class="activity-content">${this.escapeHtml(activity.content)}</div>
                </div>
            `;
			})
			.join("");
	}

	escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
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
}

// Initialize the client when DOM is ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		new CyrusDemoClient();
	});
} else {
	new CyrusDemoClient();
}
