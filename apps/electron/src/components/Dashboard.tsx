import {
	CheckCircle,
	Circle,
	Clipboard,
	Clock,
	ExternalLink,
	Pause,
	RotateCcw,
	XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

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

interface DashboardProps {
	issues: Map<string, Issue>;
	selectedIssueId: string | null;
	onSelectIssue: (issueId: string) => void;
	onIssueAction: (
		issueId: string,
		action: "pause" | "restart" | "copy" | "open",
	) => void;
}

function getStatusIcon(status: Issue["status"]) {
	switch (status) {
		case "active":
			return (
				<Circle className="w-3 h-3 fill-green-500 text-green-500 animate-pulse" />
			);
		case "waiting":
			return <Circle className="w-3 h-3 fill-yellow-500 text-yellow-500" />;
		case "paused":
			return <Clock className="w-3 h-3 text-gray-500" />;
		case "completed":
			return <CheckCircle className="w-3 h-3 text-green-500" />;
		case "failed":
			return <XCircle className="w-3 h-3 text-red-500" />;
	}
}

function getStatusLabel(status: Issue["status"]) {
	switch (status) {
		case "active":
			return "🟢";
		case "waiting":
			return "🟡";
		case "paused":
			return "⏸️";
		case "completed":
			return "✅";
		case "failed":
			return "❌";
	}
}

function formatDuration(startTime?: number): string {
	if (!startTime) return "";

	const duration = Date.now() - startTime;
	const minutes = Math.floor(duration / 60000);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	return `${minutes}m`;
}

export function Dashboard({
	issues,
	selectedIssueId,
	onSelectIssue,
	onIssueAction,
}: DashboardProps) {
	const selectedIssue = selectedIssueId ? issues.get(selectedIssueId) : null;

	// Group issues by status
	const activeIssues = Array.from(issues.values()).filter(
		(i) =>
			i.status === "active" || i.status === "waiting" || i.status === "paused",
	);
	const completedIssues = Array.from(issues.values()).filter(
		(i) => i.status === "completed" || i.status === "failed",
	);

	return (
		<div className="flex h-full">
			{/* Left Sidebar - Issue List */}
			<div className="w-80 border-r flex flex-col">
				<div className="p-4 border-b">
					<h2 className="font-semibold">ACTIVE ISSUES</h2>
				</div>
				<ScrollArea className="flex-1">
					<div className="p-2">
						{activeIssues.map((issue) => (
							<button
								type="button"
								key={issue.id}
								onClick={() => onSelectIssue(issue.id)}
								className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
									selectedIssueId === issue.id ? "bg-accent" : "hover:bg-muted"
								}`}
							>
								<div className="flex items-center gap-2">
									<span className="text-lg">
										{getStatusLabel(issue.status)}
									</span>
									<span className="font-mono text-sm">{issue.identifier}</span>
									<span className="text-sm text-muted-foreground ml-auto">
										{formatDuration(issue.startTime)}
									</span>
								</div>
							</button>
						))}

						{activeIssues.length === 0 && (
							<p className="text-center text-muted-foreground py-8">
								No active issues
							</p>
						)}
					</div>

					{completedIssues.length > 0 && (
						<>
							<Separator className="my-2" />
							<div className="p-2">
								<p className="text-sm font-semibold text-muted-foreground px-3 mb-2">
									COMPLETED
								</p>
								{completedIssues.map((issue) => (
									<button
										type="button"
										key={issue.id}
										onClick={() => onSelectIssue(issue.id)}
										className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
											selectedIssueId === issue.id
												? "bg-accent"
												: "hover:bg-muted"
										}`}
									>
										<div className="flex items-center gap-2">
											<span className="text-lg">
												{getStatusLabel(issue.status)}
											</span>
											<span className="font-mono text-sm">
												{issue.identifier}
											</span>
											<CheckCircle className="w-3 h-3 text-green-500 ml-auto" />
										</div>
									</button>
								))}
							</div>
						</>
					)}
				</ScrollArea>
			</div>

			{/* Right Panel - Issue Details */}
			<div className="flex-1 flex flex-col">
				{selectedIssue ? (
					<>
						{/* Issue Header */}
						<div className="p-4 border-b">
							<h1 className="text-xl font-semibold">
								{selectedIssue.identifier}: {selectedIssue.title}
							</h1>
							<div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
								<span className="flex items-center gap-1">
									{getStatusIcon(selectedIssue.status)}
									{selectedIssue.status === "active"
										? "Active"
										: selectedIssue.status === "waiting"
											? "Waiting"
											: selectedIssue.status === "paused"
												? "Paused"
												: selectedIssue.status === "completed"
													? "Completed"
													: "Failed"}
								</span>
								{selectedIssue.branch && (
									<>
										<span>•</span>
										<span>Branch: {selectedIssue.branch}</span>
									</>
								)}
								{selectedIssue.startTime && (
									<>
										<span>•</span>
										<span>{formatDuration(selectedIssue.startTime)}</span>
									</>
								)}
							</div>
						</div>

						{/* Log Content */}
						<ScrollArea className="flex-1 p-4">
							<div className="space-y-4">
								{selectedIssue.logs?.map((log, index) => (
									<div key={index} className="space-y-2">
										<div className="text-sm text-muted-foreground">
											[{log.timestamp}] {log.message}
										</div>
										{log.type === "code" && log.content && (
											<pre className="bg-muted p-3 rounded-lg text-sm overflow-x-auto">
												<code>{log.content}</code>
											</pre>
										)}
										{log.type === "diff" && log.content && (
											<div className="bg-muted p-3 rounded-lg text-sm font-mono">
												{log.content.split("\n").map((line, i) => (
													<div
														key={i}
														className={
															line.startsWith("+")
																? "text-green-600"
																: line.startsWith("-")
																	? "text-red-600"
																	: ""
														}
													>
														{line}
													</div>
												))}
											</div>
										)}
									</div>
								)) || (
									<div className="text-center text-muted-foreground py-8">
										<p>No activity yet</p>
										<p className="text-sm mt-2">
											Waiting for Claude to start processing...
										</p>
									</div>
								)}
							</div>
						</ScrollArea>

						{/* Action Buttons */}
						<div className="p-4 border-t flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => onIssueAction(selectedIssue.id, "pause")}
								disabled={selectedIssue.status !== "active"}
							>
								<Pause className="w-4 h-4 mr-2" />
								Pause
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => onIssueAction(selectedIssue.id, "restart")}
								disabled={selectedIssue.status === "active"}
							>
								<RotateCcw className="w-4 h-4 mr-2" />
								Restart
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => onIssueAction(selectedIssue.id, "copy")}
							>
								<Clipboard className="w-4 h-4 mr-2" />
								Copy Log
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => onIssueAction(selectedIssue.id, "open")}
							>
								<ExternalLink className="w-4 h-4 mr-2" />
								Open in Linear
							</Button>
						</div>
					</>
				) : (
					<div className="flex-1 flex items-center justify-center text-muted-foreground">
						<div className="text-center">
							<p className="text-lg mb-2">Select an issue to view details</p>
							<p className="text-sm">
								Active issues will appear here when assigned
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
