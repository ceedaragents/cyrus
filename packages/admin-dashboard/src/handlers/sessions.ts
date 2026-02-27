/**
 * GET /api/admin/sessions — list active sessions
 *
 * This returns an empty list by default. When wired into EdgeWorker,
 * the handler is overridden to pull live data from agentSessionManagers.
 */
export function handleGetSessions(
	getActiveSessions?: () => Array<{
		issueId: string;
		repositoryId: string;
		isRunning: boolean;
	}>,
) {
	return async () => {
		const sessions = getActiveSessions?.() ?? [];
		return {
			success: true,
			data: { sessions, count: sessions.length },
		};
	};
}
