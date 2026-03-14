import { useState } from "react";
import { saveDashboardConfig } from "@/api/config";
import { useConnectionStore } from "@/store/connectionStore";

export function ConnectPage() {
	const { cyrusUrl, apiKey, setConnection } = useConnectionStore();
	const [url, setUrl] = useState(cyrusUrl);
	const [key, setKey] = useState(apiKey);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleConnect = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError("");
		try {
			const res = await fetch(`${url}/status`);
			if (!res.ok) throw new Error(`Server responded with ${res.status}`);
			await saveDashboardConfig({ cyrusUrl: url, apiKey: key });
			setConnection(url, key);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not reach Cyrus");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-muted/20">
			<div className="w-full max-w-md bg-card border rounded-xl shadow-sm p-8">
				<h1 className="text-2xl font-bold mb-1">Connect to Cyrus</h1>
				<p className="text-sm text-muted-foreground mb-6">
					Enter your Cyrus instance URL and API key to get started.
				</p>
				<form onSubmit={handleConnect} className="space-y-4">
					<div>
						<label className="block text-sm font-medium mb-1">Cyrus URL</label>
						<input
							type="url"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
							placeholder="http://localhost:3456"
							required
						/>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">API Key</label>
						<input
							type="password"
							value={key}
							onChange={(e) => setKey(e.target.value)}
							className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
							placeholder="CYRUS_API_KEY value from ~/.cyrus/.env"
						/>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
					<button
						type="submit"
						disabled={loading}
						className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
					>
						{loading ? "Connecting…" : "Connect"}
					</button>
				</form>
			</div>
		</div>
	);
}
