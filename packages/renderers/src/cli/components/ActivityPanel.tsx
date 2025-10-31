import type { EventEmitter } from "node:events";
import chalk from "chalk";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import React from "react";
import { useEffect, useState } from "react";
import type { ActivityItem, StatusIcons } from "../CLIRenderer.js";

interface SessionState {
	session: {
		id: string;
		issueId: string;
		issueTitle: string;
		startedAt: Date;
	};
	activities: ActivityItem[];
	status: "running" | "complete" | "error";
	error?: Error;
}

interface Config {
	verboseFormatting: boolean;
	maxActivities: number;
	statusIcons: StatusIcons;
}

interface ActivityPanelProps {
	sessions: SessionState[];
	config: Config;
	eventEmitter: EventEmitter;
	onMessage: (sessionId: string, message: string) => void;
	onStop: (sessionId: string, reason?: string) => void;
}

/**
 * Main activity panel component for CLI renderer
 */
export const ActivityPanel: React.FC<ActivityPanelProps> = ({
	sessions,
	config,
	eventEmitter,
	onMessage,
	onStop,
}) => {
	const [currentSessions, setCurrentSessions] =
		useState<SessionState[]>(sessions);
	const [inputValue, setInputValue] = useState("");
	const [scrollOffset, setScrollOffset] = useState(0);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		sessions[0]?.session?.id ?? null,
	);

	// Listen for updates from the renderer
	useEffect(() => {
		const updateHandler = (updatedSessions: SessionState[]) => {
			setCurrentSessions(updatedSessions);

			// Auto-select first session if none selected
			if (!selectedSessionId && updatedSessions.length > 0) {
				setSelectedSessionId(updatedSessions[0].session.id);
			}
		};

		eventEmitter.on("update", updateHandler);

		return () => {
			eventEmitter.off("update", updateHandler);
		};
	}, [eventEmitter, selectedSessionId]);

	// Handle keyboard input
	useInput((input, key) => {
		// Ctrl+S to stop
		if (key.ctrl && input === "s") {
			if (selectedSessionId) {
				onStop(selectedSessionId, "User stopped via Ctrl+S");
			}
		}

		// Ctrl+C to exit
		if (key.ctrl && input === "c") {
			process.exit(0);
		}

		// Up/Down arrows for scrolling
		if (key.upArrow) {
			setScrollOffset((prev) => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setScrollOffset((prev) => prev + 1);
		}
	});

	const handleSubmit = (value: string) => {
		if (value.trim() && selectedSessionId) {
			onMessage(selectedSessionId, value.trim());
			setInputValue("");
		}
	};

	const selectedSession = currentSessions.find(
		(s) => s.session.id === selectedSessionId,
	);

	return (
		<Box flexDirection="column" width="100%" height="100%">
			{/* Header */}
			<Box borderStyle="single" borderColor="cyan" paddingX={1}>
				<Text bold color="cyan">
					Cyrus Agent Activity Panel
				</Text>
			</Box>

			{/* Sessions list */}
			{currentSessions.length === 0 ? (
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>No active sessions</Text>
				</Box>
			) : (
				currentSessions.map((sessionState) => (
					<SessionPanel
						key={sessionState.session.id}
						sessionState={sessionState}
						config={config}
						scrollOffset={scrollOffset}
						isSelected={sessionState.session.id === selectedSessionId}
					/>
				))
			)}

			{/* Input area */}
			<Box borderStyle="single" borderColor="green" paddingX={1} marginTop={1}>
				<Box flexDirection="column" width="100%">
					<Text bold color="green">
						Message (Press Enter to send, Ctrl+S to stop, Ctrl+C to exit):
					</Text>
					<TextInput
						value={inputValue}
						onChange={setInputValue}
						onSubmit={handleSubmit}
						placeholder="Type your message..."
					/>
				</Box>
			</Box>

			{/* Status bar */}
			<Box borderStyle="single" borderColor="gray" paddingX={1}>
				<Text dimColor>
					{selectedSession
						? `${selectedSession.session.issueTitle} - Status: ${selectedSession.status}`
						: "No session selected"}
				</Text>
			</Box>
		</Box>
	);
};

interface SessionPanelProps {
	sessionState: SessionState;
	config: Config;
	scrollOffset: number;
	isSelected: boolean;
}

/**
 * Panel for displaying a single session's activities
 */
const SessionPanel: React.FC<SessionPanelProps> = ({
	sessionState,
	config,
	scrollOffset,
	isSelected,
}) => {
	const { session, activities, status } = sessionState;

	// Apply scroll offset
	const visibleActivities = activities.slice(scrollOffset, scrollOffset + 20);

	return (
		<Box
			flexDirection="column"
			borderStyle={isSelected ? "double" : "single"}
			borderColor={isSelected ? "yellow" : "gray"}
			paddingX={1}
			marginY={1}
		>
			{/* Session header */}
			<Box marginBottom={1}>
				<Text bold>
					{status === "running" && (
						<>
							<Spinner type="dots" />{" "}
						</>
					)}
					{session.issueTitle}
				</Text>
				<Text dimColor> ({session.issueId})</Text>
			</Box>

			{/* Activities */}
			{visibleActivities.length === 0 ? (
				<Text dimColor>No activities yet...</Text>
			) : (
				visibleActivities.map((activity) => (
					<ActivityItemComponent
						key={activity.id}
						activity={activity}
						config={config}
					/>
				))
			)}

			{/* Scroll indicator */}
			{activities.length > visibleActivities.length && (
				<Box marginTop={1}>
					<Text dimColor>
						Showing {scrollOffset + 1}-{scrollOffset + visibleActivities.length}{" "}
						of {activities.length} (Use ↑↓ to scroll)
					</Text>
				</Box>
			)}
		</Box>
	);
};

interface ActivityItemProps {
	activity: ActivityItem;
	config: Config;
}

/**
 * Single activity item display
 */
const ActivityItemComponent: React.FC<ActivityItemProps> = ({
	activity,
	config,
}) => {
	const timestamp = activity.timestamp.toLocaleTimeString();
	const icon = config.verboseFormatting ? activity.icon : "●";

	// Colorize based on activity type
	let colorFn = chalk.white;
	switch (activity.type) {
		case "error":
			colorFn = chalk.red;
			break;
		case "complete":
			colorFn = chalk.green;
			break;
		case "elicitation":
		case "prompt":
			colorFn = chalk.yellow;
			break;
		case "thought":
			colorFn = chalk.cyan;
			break;
		case "action":
		case "tool-use":
			colorFn = chalk.blue;
			break;
	}

	return (
		<Box flexDirection="column" marginY={0}>
			<Box>
				<Text dimColor>[{timestamp}]</Text>
				<Text> {icon} </Text>
				<Text bold color={colorFn.constructor.name as any}>
					{activity.type}
				</Text>
			</Box>
			<Box paddingLeft={2}>
				<Text>{activity.content}</Text>
			</Box>
		</Box>
	);
};
