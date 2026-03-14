export interface SessionSummary {
	id: string;
	status: string;
	createdAt: number;
	updatedAt: number;
	issueContext?: {
		issueId: string;
		issueIdentifier?: string;
		trackerId?: string;
	};
	workspace?: { path: string };
	claudeSessionId?: string;
	geminiSessionId?: string;
	codexSessionId?: string;
	cursorSessionId?: string;
	metadata?: {
		model?: string;
		totalCostUsd?: number;
		procedure?: {
			procedureName?: string;
			currentSubroutineIndex?: number;
			subroutineHistory?: Array<{ subroutine: string; completedAt: number }>;
		};
	};
}

export async function getSessions(): Promise<SessionSummary[]> {
	const res = await fetch("/api/sessions");
	if (!res.ok) throw new Error("Failed to fetch sessions");
	const data = await res.json();
	return data.sessions ?? [];
}
