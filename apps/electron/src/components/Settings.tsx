import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	FolderOpen,
	Loader2,
	LogOut,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SettingsProps {
	onClose: () => void;
}

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
	autoStart?: boolean;
}

interface ConnectionStatus {
	connected: boolean;
	proxyUrl: string;
	hasToken: boolean;
}

export function Settings({ onClose }: SettingsProps) {
	const [config, setConfig] = useState<Config>({});
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
		connected: false,
		proxyUrl: "",
		hasToken: false,
	});
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [saveMessage, setSaveMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [localChanges, setLocalChanges] = useState<Partial<Config>>({});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const loadSettings = useCallback(async () => {
		setIsLoading(true);
		try {
			const [configData, statusData] = await Promise.all([
				window.cyrus.getConfig(),
				window.cyrus.getConnectionStatus(),
			]);
			setConfig(configData);
			setConnectionStatus(statusData);
			setLocalChanges({});
		} catch (error) {
			console.error("Failed to load settings:", error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		loadSettings();
	}, [loadSettings]);

	const handleSave = async () => {
		setIsSaving(true);
		setSaveMessage(null);
		setFieldErrors({});

		try {
			// Validate paths before saving
			const pathsToValidate = {
				claudePath: localChanges.claudePath ?? config.claudePath,
				repository: localChanges.repository ?? config.repository,
				workspaceBaseDir:
					localChanges.workspaceBaseDir ?? config.workspaceBaseDir,
			};

			const errors = await window.cyrus.validatePaths(pathsToValidate);

			if (Object.keys(errors).length > 0) {
				setFieldErrors(errors);
				setSaveMessage({
					type: "error",
					text: "Please fix the errors before saving",
				});
				return;
			}

			await window.cyrus.saveConfig({
				...config,
				...localChanges,
			});
			setConfig({ ...config, ...localChanges });
			setLocalChanges({});
			setSaveMessage({ type: "success", text: "Settings saved successfully" });

			// Clear success message after 3 seconds
			setTimeout(() => setSaveMessage(null), 3000);
		} catch (error) {
			setSaveMessage({
				type: "error",
				text:
					error instanceof Error ? error.message : "Failed to save settings",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleChange = (field: keyof Config, value: any) => {
		setLocalChanges({ ...localChanges, [field]: value });
	};

	const hasChanges = Object.keys(localChanges).length > 0;

	const handleBrowseFolder = async (
		field: "claudePath" | "repository" | "workspaceBaseDir",
	) => {
		try {
			const path =
				field === "claudePath"
					? await window.cyrus.selectFile()
					: await window.cyrus.selectFolder();

			if (path) {
				handleChange(field, path);
			}
		} catch (error) {
			console.error("Failed to select path:", error);
		}
	};

	const handleReconnect = async () => {
		try {
			await window.cyrus.connect();
			const status = await window.cyrus.getConnectionStatus();
			setConnectionStatus(status);
		} catch (error) {
			console.error("Failed to reconnect:", error);
		}
	};

	const handleDisconnect = async () => {
		try {
			await window.cyrus.disconnect();
			const status = await window.cyrus.getConnectionStatus();
			setConnectionStatus(status);
		} catch (error) {
			console.error("Failed to disconnect:", error);
		}
	};

	const handleSignOut = () => {
		if (
			window.confirm(
				"Are you sure you want to sign out? This will clear your Linear connection and return you to the setup screen.",
			)
		) {
			// Clear credentials and return to onboarding
			window.cyrus.saveConfig({
				...config,
				proxyUrl: undefined,
				edgeToken: undefined,
				linearToken: undefined,
				workspaceId: undefined,
				workspaceName: undefined,
				isOnboarded: false,
			});
			window.location.reload();
		}
	};

	const handleResetDefaults = () => {
		if (
			window.confirm("Are you sure you want to reset all settings to defaults?")
		) {
			setLocalChanges({
				claudePath: "/usr/local/bin/claude",
				baseBranch: "main",
				workspaceBaseDir: "~/cyrus-workspaces",
				autoStart: true,
			});
		}
	};

	if (isLoading) {
		return (
			<div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
				<Card className="w-full max-w-3xl">
					<CardContent className="flex items-center justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</CardContent>
				</Card>
			</div>
		);
	}

	const currentClaudePath = localChanges.claudePath ?? config.claudePath;
	const currentRepository = localChanges.repository ?? config.repository;
	const currentWorkspaceDir =
		localChanges.workspaceBaseDir ?? config.workspaceBaseDir;
	const currentBaseBranch = localChanges.baseBranch ?? config.baseBranch;
	const currentAutoStart = localChanges.autoStart ?? config.autoStart;

	return (
		<div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
			<Card className="w-full max-w-3xl h-[700px] flex flex-col">
				<CardHeader className="border-b flex-shrink-0">
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Settings</CardTitle>
							<CardDescription>
								Configure Cyrus to work with your development environment
							</CardDescription>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={onClose}
							className="h-8 w-8"
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</CardHeader>

				<CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
					<Tabs defaultValue="general" className="flex-1 flex flex-col">
						<TabsList className="w-full justify-start rounded-none border-b px-6 flex-shrink-0">
							<TabsTrigger value="general">General</TabsTrigger>
							<TabsTrigger value="claude">Claude</TabsTrigger>
							<TabsTrigger value="repository">Repository</TabsTrigger>
							<TabsTrigger value="connection">Connection</TabsTrigger>
							<TabsTrigger value="account">Account</TabsTrigger>
						</TabsList>

						<div className="flex-1 overflow-auto">
							<TabsContent value="general" className="space-y-6 p-6">
								<div className="space-y-4">
									<div className="flex items-center space-x-2">
										<Checkbox
											id="autoStart"
											checked={currentAutoStart}
											onCheckedChange={(checked) =>
												handleChange("autoStart", checked)
											}
										/>
										<Label htmlFor="autoStart" className="cursor-pointer">
											Launch Cyrus on system startup
										</Label>
									</div>
									<p className="text-xs text-muted-foreground">
										Automatically start Cyrus when you log in to your computer
									</p>
								</div>

								<Separator />

								<div className="space-y-2">
									<Label>Workspace Name</Label>
									<p className="text-sm text-muted-foreground">
										{config.workspaceName ||
											(config.workspaceId ? "Connected" : "Not connected")}
									</p>
								</div>
							</TabsContent>

							<TabsContent value="claude" className="space-y-6 p-6">
								<div className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="claudePath">Claude CLI Path</Label>
										<div className="flex gap-2">
											<Input
												id="claudePath"
												value={currentClaudePath || ""}
												onChange={(e) =>
													handleChange("claudePath", e.target.value)
												}
												placeholder="/usr/local/bin/claude"
											/>
											<Button
												variant="outline"
												size="icon"
												onClick={() => handleBrowseFolder("claudePath")}
											>
												<FolderOpen className="h-4 w-4" />
											</Button>
										</div>
										<p className="text-xs text-muted-foreground">
											Path to the Claude Code CLI executable
										</p>
										{fieldErrors.claudePath && (
											<p className="text-xs text-red-500 mt-1">
												{fieldErrors.claudePath}
											</p>
										)}
									</div>
								</div>
							</TabsContent>

							<TabsContent value="repository" className="space-y-6 p-6">
								<div className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="repository">Default Repository</Label>
										<div className="flex gap-2">
											<Input
												id="repository"
												value={currentRepository || ""}
												onChange={(e) =>
													handleChange("repository", e.target.value)
												}
												placeholder="/path/to/your/repository"
											/>
											<Button
												variant="outline"
												size="icon"
												onClick={() => handleBrowseFolder("repository")}
											>
												<FolderOpen className="h-4 w-4" />
											</Button>
										</div>
										<p className="text-xs text-muted-foreground">
											The main repository Cyrus will work on
										</p>
										{fieldErrors.repository && (
											<p className="text-xs text-red-500 mt-1">
												{fieldErrors.repository}
											</p>
										)}
									</div>

									<div className="space-y-2">
										<Label htmlFor="baseBranch">Base Branch</Label>
										<Input
											id="baseBranch"
											value={currentBaseBranch || ""}
											onChange={(e) =>
												handleChange("baseBranch", e.target.value)
											}
											placeholder="main"
										/>
										<p className="text-xs text-muted-foreground">
											Branch to create worktrees from
										</p>
									</div>

									<div className="space-y-2">
										<Label htmlFor="workspaceDir">Workspace Directory</Label>
										<div className="flex gap-2">
											<Input
												id="workspaceDir"
												value={currentWorkspaceDir || ""}
												onChange={(e) =>
													handleChange("workspaceBaseDir", e.target.value)
												}
												placeholder="~/cyrus-workspaces"
											/>
											<Button
												variant="outline"
												size="icon"
												onClick={() => handleBrowseFolder("workspaceBaseDir")}
											>
												<FolderOpen className="h-4 w-4" />
											</Button>
										</div>
										<p className="text-xs text-muted-foreground">
											Where Cyrus creates issue workspaces
										</p>
										{fieldErrors.workspaceBaseDir && (
											<p className="text-xs text-red-500 mt-1">
												{fieldErrors.workspaceBaseDir}
											</p>
										)}
									</div>
								</div>
							</TabsContent>

							<TabsContent value="connection" className="space-y-6 p-6">
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<div className="space-y-1">
											<Label>Connection Status</Label>
											<div className="flex items-center gap-2">
												{connectionStatus.connected ? (
													<>
														<CheckCircle2 className="h-4 w-4 text-green-500" />
														<span className="text-sm text-green-600">
															Connected
														</span>
													</>
												) : (
													<>
														<AlertCircle className="h-4 w-4 text-yellow-500" />
														<span className="text-sm text-yellow-600">
															Disconnected
														</span>
													</>
												)}
											</div>
										</div>
										<div className="flex gap-2">
											{connectionStatus.connected ? (
												<Button
													variant="outline"
													size="sm"
													onClick={handleDisconnect}
												>
													Disconnect
												</Button>
											) : (
												<Button
													variant="outline"
													size="sm"
													onClick={handleReconnect}
												>
													<RefreshCw className="h-4 w-4 mr-2" />
													Reconnect
												</Button>
											)}
										</div>
									</div>

									<Separator />

									<div className="space-y-2">
										<Label>Proxy URL</Label>
										<p className="text-sm text-muted-foreground font-mono">
											{connectionStatus.proxyUrl || "Not configured"}
										</p>
									</div>

									<div className="space-y-2">
										<Label>Workspace ID</Label>
										<p className="text-sm text-muted-foreground font-mono">
											{config.workspaceId || "Not configured"}
										</p>
									</div>
								</div>
							</TabsContent>

							<TabsContent value="account" className="space-y-6 p-6">
								<div className="space-y-4">
									<div className="space-y-2">
										<Label>Linear Workspace</Label>
										<p className="text-sm text-muted-foreground">
											{config.workspaceName ||
												(config.workspaceId
													? `Workspace ${config.workspaceId}`
													: "Not connected")}
										</p>
									</div>

									<Separator />

									<div className="space-y-4">
										<Button
											variant="outline"
											className="w-full"
											onClick={() => window.cyrus.startOAuth()}
										>
											Re-authenticate with Linear
										</Button>

										<Button
											variant="destructive"
											className="w-full"
											onClick={handleSignOut}
										>
											<LogOut className="h-4 w-4 mr-2" />
											Sign Out
										</Button>
									</div>
								</div>
							</TabsContent>
						</div>
					</Tabs>

					{/* Advanced Settings */}
					<div className="border-t flex-shrink-0">
						<button
							type="button"
							onClick={() => setShowAdvanced(!showAdvanced)}
							className="w-full px-6 py-3 flex items-center justify-between text-sm hover:bg-muted/50 transition-colors"
						>
							<span className="font-medium">Advanced Settings</span>
							{showAdvanced ? (
								<ChevronUp className="h-4 w-4" />
							) : (
								<ChevronDown className="h-4 w-4" />
							)}
						</button>

						{showAdvanced && (
							<div className="px-6 pb-6 space-y-4">
								<div className="flex items-center space-x-2">
									<Checkbox
										id="debugMode"
										// TODO: Add debug mode support
									/>
									<Label htmlFor="debugMode" className="cursor-pointer">
										Enable debug mode
									</Label>
								</div>

								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											if (
												window.confirm(
													"Are you sure you want to clear all cached data?",
												)
											) {
												// TODO: Implement cache clearing
											}
										}}
									>
										<Trash2 className="h-4 w-4 mr-2" />
										Clear Cache
									</Button>

									<Button
										variant="outline"
										size="sm"
										onClick={handleResetDefaults}
									>
										Reset to Defaults
									</Button>
								</div>
							</div>
						)}
					</div>

					{/* Footer */}
					<div className="border-t px-6 py-4 flex-shrink-0">
						<div className="flex items-center justify-between">
							<div>
								{saveMessage && (
									<p
										className={`text-sm ${
											saveMessage.type === "success"
												? "text-green-600"
												: "text-red-600"
										}`}
									>
										{saveMessage.text}
									</p>
								)}
							</div>
							<div className="flex gap-2">
								<Button variant="outline" onClick={onClose}>
									Cancel
								</Button>
								<Button onClick={handleSave} disabled={!hasChanges || isSaving}>
									{isSaving ? (
										<>
											<Loader2 className="h-4 w-4 mr-2 animate-spin" />
											Saving...
										</>
									) : (
										"Save Changes"
									)}
								</Button>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
