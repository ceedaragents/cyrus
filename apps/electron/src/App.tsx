import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { Onboarding } from "@/components/Onboarding";
import { Settings as SettingsPanel } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import "./App.css";

interface Config {
	proxyUrl?: string;
	edgeToken?: string;
	linearToken?: string;
	workspaceId?: string;
	workspaceName?: string;
	claudePath?: string;
	workspaceBaseDir?: string;
	baseBranch?: string;
	repository?: string;
	workspaceDir?: string;
	autoStart?: boolean;
	isOnboarded?: boolean;
}

interface Issue {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	status: "active" | "waiting" | "paused" | "completed" | "failed";
	startTime?: number;
	branch?: string;
	logs?: LogEntry[];
}

interface LogEntry {
	timestamp: string;
	message: string;
	type: "text" | "tool" | "code" | "diff";
	toolName?: string;
	content?: string;
}

function App() {
	const [config, setConfig] = useState<Config>({});
	const [isLoading, setIsLoading] = useState(true);
	const [isConnected, setIsConnected] = useState(false);
	const [issues, setIssues] = useState<Map<string, Issue>>(new Map());
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [showSettings, setShowSettings] = useState(false);

	useEffect(() => {
		// Load initial config
		window.cyrus.getConfig().then((loadedConfig) => {
			console.log("Loaded config:", loadedConfig);
			const config = loadedConfig as Config;
			setConfig(config);
			setIsLoading(false);

			// Check connection status
			if (config.proxyUrl && config.edgeToken) {
				window.cyrus.getConnectionStatus().then((status) => {
					console.log("Connection status:", status);
					setIsConnected(status.connected);

					// Only connect if not already connected
					if (!status.connected) {
						window.cyrus.connect();
					}
				});
			}
		});

		// Set up event listeners
		window.cyrus.onSetupComplete((data) => {
			console.log("Setup complete:", data);
			window.cyrus.getConfig().then(setConfig);
			setIsConnected(true);
		});

		window.cyrus.onSetupError((error) => {
			console.error("Setup error:", error);
			alert(`Setup error: ${error}`);
		});

		window.cyrus.onProxyConnected(() => {
			setIsConnected(true);
		});

		window.cyrus.onProxyDisconnected(() => {
			setIsConnected(false);
		});

		window.cyrus.onEventProcessed((event) => {
			// Update issues based on event
			if (event.data?.issue) {
				const issue = event.data.issue;
				setIssues((prev) => {
					const updated = new Map(prev);
					const existing = updated.get(issue.id) || {
						id: issue.id,
						identifier: issue.identifier,
						title: issue.title,
						description: issue.description,
						status: "active" as const,
						startTime: Date.now(),
						logs: [],
					};

					// Add log entry
					existing.logs = [
						...(existing.logs || []),
						{
							timestamp: new Date().toLocaleTimeString(),
							message: `Processing ${event.data.webhookType}`,
							type: "text" as const,
						},
					];

					updated.set(issue.id, existing);
					return updated;
				});
			}
		});

		window.cyrus.onEventError((data) => {
			console.error("Event error:", data);
		});

		return () => {
			// Clean up listeners
			window.cyrus.removeAllListeners("setup-complete");
			window.cyrus.removeAllListeners("setup-error");
			window.cyrus.removeAllListeners("proxy-connected");
			window.cyrus.removeAllListeners("proxy-disconnected");
			window.cyrus.removeAllListeners("event-processed");
			window.cyrus.removeAllListeners("event-error");
		};
	}, []);

	const handleOnboardingComplete = async (onboardingConfig: any) => {
		const fullConfig = {
			...config,
			...onboardingConfig,
			isOnboarded: true,
		};

		await window.cyrus.saveConfig(fullConfig);
		setConfig(fullConfig);

		// Connect to proxy if we have credentials
		if (fullConfig.proxyUrl && fullConfig.edgeToken) {
			await window.cyrus.connect();
		}
	};

	const handleIssueAction = (issueId: string, action: string) => {
		console.log("Issue action:", issueId, action);
		// TODO: Implement pause, restart, copy, open actions
	};

	// Show loading state while config loads
	if (isLoading) {
		return (
			<div className="h-screen flex items-center justify-center">
				<div className="text-muted-foreground">Loading...</div>
			</div>
		);
	}

	// Show onboarding if not completed
	if (!config.isOnboarded) {
		return <Onboarding onComplete={handleOnboardingComplete} />;
	}

	return (
		<div className="h-screen flex flex-col bg-background text-foreground">
			{/* Title Bar */}
			<div className="border-b px-4 py-2 flex items-center justify-between bg-card">
				<div className="flex items-center gap-3">
					<h1 className="font-semibold text-sm">Cyrus</h1>
					<div className="flex items-center gap-1.5">
						<div
							className={`w-1.5 h-1.5 rounded-full transition-colors ${
								isConnected
									? "bg-green-500 animate-pulse"
									: "bg-muted-foreground/50"
							}`}
						/>
						<span className="text-xs text-muted-foreground">
							{isConnected ? "Connected" : "Disconnected"}
						</span>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => setShowSettings(!showSettings)}
				>
					<Settings className="h-4 w-4" />
				</Button>
			</div>

			{/* Main Content */}
			<div className="flex-1 overflow-hidden">
				<Dashboard
					issues={issues}
					selectedIssueId={selectedIssueId}
					onSelectIssue={setSelectedIssueId}
					onIssueAction={handleIssueAction}
				/>
			</div>

			{/* Status Bar */}
			<div className="border-t px-4 py-1.5 text-xs text-muted-foreground bg-card">
				<div className="flex items-center justify-between">
					<span>
						{issues.size > 0
							? `${Array.from(issues.values()).filter((i) => i.status === "active").length} active • ${
									Array.from(issues.values()).filter(
										(i) => i.status === "completed",
									).length
								} completed`
							: "No active issues"}
					</span>
					<span className="text-muted-foreground/50">
						{new Date().toLocaleDateString()}
					</span>
				</div>
			</div>

			{/* Settings Panel */}
			{showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
		</div>
	);
}

export default App;
