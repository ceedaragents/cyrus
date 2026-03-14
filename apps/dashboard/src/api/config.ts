export async function getConfig(): Promise<Record<string, unknown>> {
	const res = await fetch("/api/config");
	if (!res.ok) throw new Error("Failed to fetch config");
	return res.json();
}

export async function saveConfig(
	config: Record<string, unknown>,
): Promise<void> {
	const res = await fetch("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(config),
	});
	if (!res.ok) throw new Error("Failed to save config");
}

export async function getEnv(): Promise<{
	env: Record<string, { value: string; isSecret: boolean }>;
}> {
	const res = await fetch("/api/env");
	if (!res.ok) throw new Error("Failed to fetch env");
	return res.json();
}

export async function saveEnv(env: Record<string, string>): Promise<void> {
	const res = await fetch("/api/env", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ env }),
	});
	if (!res.ok) throw new Error("Failed to save env");
}

export async function getDashboardConfig(): Promise<{
	cyrusUrl: string;
	apiKey: string;
}> {
	const res = await fetch("/api/dashboard-config");
	if (!res.ok) throw new Error("Failed to fetch dashboard config");
	return res.json();
}

export async function saveDashboardConfig(cfg: {
	cyrusUrl: string;
	apiKey: string;
}): Promise<void> {
	const res = await fetch("/api/dashboard-config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(cfg),
	});
	if (!res.ok) throw new Error("Failed to save dashboard config");
}
