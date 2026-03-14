import { ChevronDown, ChevronRight, Radio } from "lucide-react";
import { useState } from "react";
import type { SessionSummary } from "@/api/sessions";
import { Badge } from "@/components/ui/badge";
import { useSessionStream } from "@/hooks/useSessionStream";

function statusVariant(status: string) {
	switch (status) {
		case "active":
			return "success";
		case "awaiting-input":
			return "warning";
		case "complete":
			return "secondary";
		case "error":
			return "destructive";
		default:
			return "outline";
	}
}

function runnerType(s: SessionSummary) {
	if (s.claudeSessionId) return "claude";
	if (s.geminiSessionId) return "gemini";
	if (s.codexSessionId) return "codex";
	if (s.cursorSessionId) return "cursor";
	return "—";
}

function SessionCard({ session }: { session: SessionSummary }) {
	const [expanded, setExpanded] = useState(false);
	const proc = session.metadata?.procedure;

	return (
		<div className="border rounded-lg bg-card overflow-hidden">
			<button
				onClick={() => setExpanded((v) => !v)}
				className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
			>
				<span className="mt-0.5 text-muted-foreground">
					{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-mono text-sm font-medium">
							{session.issueContext?.issueIdentifier ?? session.id.slice(0, 8)}
						</span>
						<Badge variant={statusVariant(session.status)}>
							{session.status}
						</Badge>
						<Badge variant="outline" className="text-xs">
							{runnerType(session)}
						</Badge>
						{session.metadata?.model && (
							<Badge variant="outline" className="text-xs">
								{session.metadata.model}
							</Badge>
						)}
					</div>
					{proc && (
						<p className="text-xs text-muted-foreground mt-1">
							{proc.procedureName}
							{proc.subroutineHistory &&
							proc.currentSubroutineIndex !== undefined
								? ` › step ${proc.currentSubroutineIndex + 1}`
								: ""}
						</p>
					)}
				</div>
				{session.metadata?.totalCostUsd != null && (
					<span className="text-xs text-muted-foreground shrink-0">
						${session.metadata.totalCostUsd.toFixed(4)}
					</span>
				)}
			</button>

			{expanded && (
				<div className="px-4 pb-4 border-t bg-muted/10">
					<div className="mt-3 space-y-1">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
							Subroutine history
						</p>
						{proc?.subroutineHistory?.length ? (
							proc.subroutineHistory.map((h, i) => (
								<div key={i} className="flex items-center gap-2 text-xs">
									<span className="w-4 h-4 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-[10px]">
										✓
									</span>
									<span>{h.subroutine}</span>
									<span className="text-muted-foreground ml-auto">
										{new Date(h.completedAt).toLocaleTimeString()}
									</span>
								</div>
							))
						) : (
							<p className="text-xs text-muted-foreground">
								No completed subroutines yet.
							</p>
						)}
					</div>
					<div className="mt-3 text-xs text-muted-foreground">
						<span>Started {new Date(session.createdAt).toLocaleString()}</span>
						{session.workspace?.path && (
							<span className="block font-mono mt-1 truncate">
								{session.workspace.path}
							</span>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export function SessionsPage() {
	const { sessions, liveStatus } = useSessionStream();
	const [statusFilter, setStatusFilter] = useState("all");

	const filtered =
		statusFilter === "all"
			? sessions
			: sessions.filter((s) => s.status === statusFilter);

	return (
		<div className="p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-xl font-semibold">Sessions</h1>
					<p className="text-sm text-muted-foreground">
						{sessions.length} total
					</p>
				</div>
				<div className="flex items-center gap-3">
					<div
						className={`flex items-center gap-1.5 text-xs ${liveStatus === "live" ? "text-green-600" : liveStatus === "polling" ? "text-yellow-600" : "text-muted-foreground"}`}
					>
						<Radio size={12} />
						{liveStatus === "live"
							? "Live"
							: liveStatus === "polling"
								? "Polling"
								: "Connecting…"}
					</div>
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="border rounded-md text-sm px-2 py-1 bg-background"
					>
						<option value="all">All statuses</option>
						<option value="active">Active</option>
						<option value="awaiting-input">Awaiting input</option>
						<option value="complete">Complete</option>
						<option value="error">Error</option>
					</select>
				</div>
			</div>

			{filtered.length === 0 ? (
				<div className="text-center py-16 text-muted-foreground">
					<p className="text-sm">
						No sessions
						{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}
					</p>
					<p className="text-xs mt-1">
						Assign a Linear issue to Cyrus or use F1 to trigger one.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{filtered.map((s) => (
						<SessionCard key={s.id} session={s} />
					))}
				</div>
			)}
		</div>
	);
}
