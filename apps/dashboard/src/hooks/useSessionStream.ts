import { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@/api/sessions";
import { getSessions } from "@/api/sessions";

export function useSessionStream() {
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [liveStatus, setLiveStatus] = useState<
		"connecting" | "live" | "polling"
	>("connecting");
	const retryCount = useRef(0);
	const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

	const mergeSessions = (updates: SessionSummary[]) => {
		setSessions((prev) => {
			const map = new Map(prev.map((s) => [s.id, s]));
			for (const s of updates) map.set(s.id, { ...map.get(s.id), ...s });
			return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
		});
	};

	const startPolling = () => {
		setLiveStatus("polling");
		pollInterval.current = setInterval(async () => {
			try {
				const sessions = await getSessions();
				setSessions(sessions.sort((a, b) => b.updatedAt - a.updatedAt));
			} catch {}
		}, 5000);
	};

	useEffect(() => {
		let es: EventSource | null = null;

		const connect = () => {
			es = new EventSource("/api/sessions/stream");
			setLiveStatus("connecting");

			es.addEventListener("snapshot", (e) => {
				const data = JSON.parse(e.data);
				setSessions(
					(data.sessions ?? []).sort(
						(a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt,
					),
				);
				retryCount.current = 0;
				setLiveStatus("live");
			});

			es.addEventListener("sessionCreated", (e) => {
				const session = JSON.parse(e.data) as SessionSummary;
				setSessions((prev) => [
					session,
					...prev.filter((s) => s.id !== session.id),
				]);
			});

			es.addEventListener("sessionUpdated", (e) => {
				const { session } = JSON.parse(e.data) as {
					sessionId: string;
					session: SessionSummary;
				};
				mergeSessions([session]);
			});

			es.addEventListener("sessionCompleted", (e) => {
				const { session } = JSON.parse(e.data) as {
					sessionId: string;
					session: SessionSummary;
				};
				mergeSessions([session]);
			});

			es.onerror = () => {
				es?.close();
				retryCount.current++;
				if (retryCount.current >= 3) {
					startPolling();
				} else {
					setTimeout(connect, 2000 * retryCount.current);
				}
			};
		};

		connect();

		return () => {
			es?.close();
			if (pollInterval.current) clearInterval(pollInterval.current);
		};
	}, [mergeSessions, startPolling]);

	return { sessions, liveStatus };
}
