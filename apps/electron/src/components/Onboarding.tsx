import { FolderOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import cyrusLogo from "@/assets/cyrus-by-ceedar.png";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface OnboardingProps {
	onComplete: (config: OnboardingConfig) => void;
}

interface OnboardingConfig {
	claudePath: string;
	repository: string;
	workspaceDir: string;
	baseBranch: string;
	autoStart: boolean;
}

type Step =
	| "welcome"
	| "connect"
	| "claude"
	| "repository"
	| "configuration"
	| "success";

export function Onboarding({ onComplete }: OnboardingProps) {
	const [currentStep, setCurrentStep] = useState<Step>("welcome");
	const [isConnecting, setIsConnecting] = useState(false);
	const [workspaceName, setWorkspaceName] = useState("");
	const [config, setConfig] = useState<Partial<OnboardingConfig>>({
		claudePath: "/usr/local/bin/claude",
		baseBranch: "main",
		autoStart: true,
	});

	const handleConnectLinear = async () => {
		setIsConnecting(true);
		await window.cyrus.startOAuth();
		// The app will handle the OAuth callback and update our state
	};

	const handleNext = () => {
		const steps: Step[] = [
			"welcome",
			"connect",
			"claude",
			"repository",
			"configuration",
			"success",
		];
		const currentIndex = steps.indexOf(currentStep);
		if (currentIndex < steps.length - 1) {
			const nextStep = steps[currentIndex + 1];

			// Set default workspace directory when moving to configuration
			if (nextStep === "configuration" && !config.workspaceDir) {
				setConfig({
					...config,
					workspaceDir: config.repository
						? `${config.repository}/.worktrees`
						: "~/cyrus-workspaces",
				});
			}

			setCurrentStep(nextStep);
		}
	};

	const handleFinish = () => {
		console.log("handleFinish called with config:", config);
		if (config.claudePath && config.repository && config.workspaceDir) {
			onComplete(config as OnboardingConfig);
		} else {
			// Show what's missing
			const missing = [];
			if (!config.claudePath) missing.push("claudePath");
			if (!config.repository) missing.push("repository");
			if (!config.workspaceDir) missing.push("workspaceDir");
			console.error("Missing required fields:", missing);
			alert(`Please complete the following fields: ${missing.join(", ")}`);
		}
	};

	// Listen for OAuth success
	window.cyrus.onSetupComplete((data) => {
		setIsConnecting(false);
		setWorkspaceName(data.workspaceName || "Your Workspace");
		setCurrentStep("claude");
	});

	window.cyrus.onSetupError((error) => {
		setIsConnecting(false);
		alert(`Connection failed: ${error}`);
	});

	return (
		<div className="min-h-screen bg-background flex items-center justify-center p-4">
			<div className="w-full max-w-2xl">
				{/* Welcome Screen */}
				{currentStep === "welcome" && (
					<Card>
						<CardHeader className="text-center">
							<div className="mb-4">
								<img
									src={cyrusLogo}
									alt="Cyrus by Ceedar"
									className="mx-auto max-w-sm"
								/>
							</div>
							<CardDescription className="text-lg">
								Your AI teammate that handles Linear issues
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2 text-muted-foreground">
								<p>• Automatically works on issues assigned to you</p>
								<p>• Runs Claude Code in isolated environments</p>
								<p>• Posts updates back to Linear</p>
							</div>
							<div className="pt-4">
								<Button
									onClick={() => setCurrentStep("connect")}
									className="w-full"
									size="lg"
								>
									Get Started →
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Connect Linear */}
				{currentStep === "connect" && (
					<Card>
						<CardHeader>
							<CardTitle>Connect Your Linear Workspace</CardTitle>
							<CardDescription>
								We'll open your browser to connect Cyrus to Linear.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2 text-sm text-muted-foreground">
								<p>You'll need to:</p>
								<ol className="list-decimal list-inside space-y-1 ml-2">
									<li>Log in to Linear (if not already)</li>
									<li>Authorize Cyrus to access your workspace</li>
									<li>You'll be redirected back here automatically</li>
								</ol>
							</div>

							<Button
								onClick={handleConnectLinear}
								disabled={isConnecting}
								className="w-full"
								size="lg"
							>
								{isConnecting ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Connecting...
									</>
								) : (
									"Connect Linear →"
								)}
							</Button>

							<p className="text-xs text-center text-muted-foreground">
								🔒 Your credentials stay secure in the cloud proxy
							</p>
						</CardContent>
					</Card>
				)}

				{/* Verify Claude */}
				{currentStep === "claude" && (
					<Card>
						<CardHeader>
							<CardTitle>Checking Claude Installation</CardTitle>
							<CardDescription>
								✅ Linear connected to: {workspaceName}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label>Claude Code CLI Path</Label>
								<div className="flex gap-2">
									<Input
										value={config.claudePath || ""}
										onChange={(e) =>
											setConfig({ ...config, claudePath: e.target.value })
										}
										placeholder="/usr/local/bin/claude"
									/>
									<Button variant="outline" size="icon">
										<FolderOpen className="h-4 w-4" />
									</Button>
								</div>
								<p className="text-xs text-muted-foreground">
									⏳ Looking for claude at {config.claudePath}...
								</p>
							</div>

							<div className="flex gap-2">
								<Button
									variant="outline"
									onClick={() => setCurrentStep("repository")}
									className="flex-1"
								>
									Skip
								</Button>
								<Button onClick={handleNext} className="flex-1">
									Next →
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Select Repository */}
				{currentStep === "repository" && (
					<Card>
						<CardHeader>
							<CardTitle>Select Your Repository</CardTitle>
							<CardDescription>
								Which repository should Cyrus work on?
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label>📁 Recent Git Repositories:</Label>
								<RadioGroup
									value={config.repository}
									onValueChange={(value) =>
										setConfig({ ...config, repository: value })
									}
								>
									<div className="space-y-2 border rounded-lg p-3">
										<Label className="flex items-center space-x-2 cursor-pointer">
											<RadioGroupItem value="~/code/acme-app" />
											<span>~/code/acme-app (main)</span>
										</Label>
										<Label className="flex items-center space-x-2 cursor-pointer">
											<RadioGroupItem value="~/projects/api-server" />
											<span>~/projects/api-server (develop)</span>
										</Label>
										<Label className="flex items-center space-x-2 cursor-pointer">
											<RadioGroupItem value="~/work/frontend" />
											<span>~/work/frontend (main)</span>
										</Label>
									</div>
								</RadioGroup>
							</div>

							<div className="space-y-2">
								<Label>Or browse for a different repository:</Label>
								<div className="flex gap-2">
									<Input
										value={config.repository || ""}
										onChange={(e) =>
											setConfig({ ...config, repository: e.target.value })
										}
										placeholder="/path/to/repository"
									/>
									<Button variant="outline" size="icon">
										<FolderOpen className="h-4 w-4" />
									</Button>
								</div>
							</div>

							<p className="text-sm text-muted-foreground">
								💡 Cyrus will create worktrees in this repo for each issue
							</p>

							<Button
								onClick={handleNext}
								disabled={!config.repository}
								className="w-full"
							>
								Next →
							</Button>
						</CardContent>
					</Card>
				)}

				{/* Final Configuration */}
				{currentStep === "configuration" && (
					<Card>
						<CardHeader>
							<CardTitle>Final Configuration</CardTitle>
							<CardDescription>
								Repository:{" "}
								{config.repository?.split("/").pop() || config.repository} ✓
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label>Where should Cyrus create issue workspaces?</Label>
								<div className="flex gap-2">
									<Input
										value={config.workspaceDir || ""}
										onChange={(e) =>
											setConfig({ ...config, workspaceDir: e.target.value })
										}
										placeholder="~/cyrus-workspaces"
									/>
									<Button variant="outline" size="icon">
										<FolderOpen className="h-4 w-4" />
									</Button>
								</div>
							</div>

							<div className="space-y-2">
								<Label>Base branch for creating worktrees</Label>
								<Input
									value={config.baseBranch || "main"}
									onChange={(e) =>
										setConfig({ ...config, baseBranch: e.target.value })
									}
									placeholder="main"
								/>
								<p className="text-xs text-muted-foreground">
									Cyrus will create worktrees from this branch
								</p>
							</div>

							<div className="flex items-center space-x-2">
								<Checkbox
									id="autostart"
									checked={config.autoStart}
									onCheckedChange={(checked) =>
										setConfig({ ...config, autoStart: !!checked })
									}
								/>
								<Label htmlFor="autostart">Start Cyrus when you log in?</Label>
							</div>

							<Button
								onClick={() => setCurrentStep("success")}
								className="w-full"
							>
								Finish Setup
							</Button>
						</CardContent>
					</Card>
				)}

				{/* Success */}
				{currentStep === "success" && (
					<Card>
						<CardHeader className="text-center">
							<div className="text-6xl mb-4">🎉</div>
							<CardTitle className="text-2xl">You're All Set!</CardTitle>
							<CardDescription className="text-lg mt-2">
								Cyrus is now connected and ready to work!
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2 text-sm text-muted-foreground">
								<p>• Assign issues to yourself in Linear</p>
								<p>• Cyrus will automatically start working</p>
								<p>• Watch progress right here in the dashboard</p>
							</div>

							<div className="bg-muted p-4 rounded-lg">
								<p className="text-sm">You currently have 0 assigned issues.</p>
							</div>

							<Button onClick={handleFinish} className="w-full" size="lg">
								Open Dashboard
							</Button>

							<p className="text-xs text-center text-muted-foreground">
								💡 Tip: Cyrus lives in your system tray
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}
