/**
 * Cyrus Dashboard Backend
 * Thin Express server that reads/writes ~/.cyrus/config.json and ~/.cyrus/.env directly.
 * Proxies session endpoints to the running Cyrus process.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Serve built frontend in production
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
	app.use(express.static(distPath));
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const CYRUS_HOME = path.join(process.env.HOME ?? "~", ".cyrus");
const CONFIG_PATH = path.join(CYRUS_HOME, "config.json");
const ENV_PATH = path.join(CYRUS_HOME, ".env");
const DASHBOARD_CONFIG_PATH = path.join(CYRUS_HOME, "dashboard.json");

// ─── Dashboard connection config ──────────────────────────────────────────────

interface DashboardConfig {
	cyrusUrl: string;
	apiKey: string;
}

function readDashboardConfig(): DashboardConfig | null {
	try {
		if (!fs.existsSync(DASHBOARD_CONFIG_PATH)) return null;
		return JSON.parse(fs.readFileSync(DASHBOARD_CONFIG_PATH, "utf-8"));
	} catch {
		return null;
	}
}

function writeDashboardConfig(config: DashboardConfig): void {
	fs.mkdirSync(CYRUS_HOME, { recursive: true });
	fs.writeFileSync(DASHBOARD_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── Config endpoints ─────────────────────────────────────────────────────────

app.get("/api/config", (_req, res) => {
	try {
		if (!fs.existsSync(CONFIG_PATH)) {
			return res.json({ repositories: [] });
		}
		const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
		return res.json(JSON.parse(raw));
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

app.post("/api/config", (req, res) => {
	try {
		fs.mkdirSync(CYRUS_HOME, { recursive: true });
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2));
		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// ─── Repository endpoints ─────────────────────────────────────────────────────

app.put("/api/repositories/:id", (req, res) => {
	try {
		const config = fs.existsSync(CONFIG_PATH)
			? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"))
			: { repositories: [] };

		const repos: unknown[] = config.repositories ?? [];
		const idx = repos.findIndex(
			(r: unknown) => (r as { id: string }).id === req.params.id,
		);
		if (idx >= 0) {
			repos[idx] = req.body;
		} else {
			repos.push(req.body);
		}
		config.repositories = repos;
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

app.delete("/api/repositories/:id", (req, res) => {
	try {
		if (!fs.existsSync(CONFIG_PATH)) return res.json({ success: true });
		const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
		config.repositories = (config.repositories ?? []).filter(
			(r: unknown) => (r as { id: string }).id !== req.params.id,
		);
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// ─── Env endpoints ────────────────────────────────────────────────────────────

const SECRET_KEYS = new Set([
	"ANTHROPIC_API_KEY",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"GEMINI_API_KEY",
	"LINEAR_CLIENT_SECRET",
	"LINEAR_WEBHOOK_SECRET",
	"CYRUS_API_KEY",
	"CLOUDFLARE_TOKEN",
	"NGROK_AUTH_TOKEN",
]);

function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx < 0) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const val = trimmed
			.slice(eqIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		result[key] = val;
	}
	return result;
}

function serializeEnvFile(env: Record<string, string>): string {
	return `${Object.entries(env)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n")}\n`;
}

app.get("/api/env", (_req, res) => {
	try {
		const raw = fs.existsSync(ENV_PATH)
			? fs.readFileSync(ENV_PATH, "utf-8")
			: "";
		const parsed = parseEnvFile(raw);
		// Mask secret values
		const masked: Record<string, { value: string; isSecret: boolean }> = {};
		for (const [k, v] of Object.entries(parsed)) {
			masked[k] = {
				value: SECRET_KEYS.has(k) ? "••••••••" : v,
				isSecret: SECRET_KEYS.has(k),
			};
		}
		return res.json({ env: masked });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

app.post("/api/env", (req, res) => {
	try {
		// Merge: read existing, apply updates (skip masked placeholders)
		const existing = fs.existsSync(ENV_PATH)
			? parseEnvFile(fs.readFileSync(ENV_PATH, "utf-8"))
			: {};
		const updates: Record<string, string> = req.body.env ?? {};
		for (const [k, v] of Object.entries(updates)) {
			if (v === "••••••••") continue; // Don't overwrite with placeholder
			existing[k] = v;
		}
		fs.mkdirSync(CYRUS_HOME, { recursive: true });
		fs.writeFileSync(ENV_PATH, serializeEnvFile(existing));
		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// ─── Dashboard connection config endpoint ─────────────────────────────────────

app.get("/api/dashboard-config", (_req, res) => {
	const cfg = readDashboardConfig();
	return res.json(cfg ?? { cyrusUrl: "http://localhost:3456", apiKey: "" });
});

app.post("/api/dashboard-config", (req, res) => {
	try {
		writeDashboardConfig(req.body);
		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// ─── Session proxy endpoints ───────────────────────────────────────────────────

function getCyrusTarget(): DashboardConfig {
	return (
		readDashboardConfig() ?? { cyrusUrl: "http://localhost:3456", apiKey: "" }
	);
}

app.get("/api/sessions", (_req, res) => {
	const { cyrusUrl, apiKey } = getCyrusTarget();
	const url = new URL("/api/sessions", cyrusUrl);
	const options = {
		hostname: url.hostname,
		port: url.port || 3456,
		path: url.pathname,
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}` },
	};
	const proxyReq = http.request(options, (proxyRes) => {
		res.status(proxyRes.statusCode ?? 200);
		proxyRes.pipe(res);
	});
	proxyReq.on("error", (err) => {
		res
			.status(502)
			.json({ error: "Cyrus not reachable", details: err.message });
	});
	proxyReq.end();
});

app.get("/api/sessions/stream", (req, res) => {
	const { cyrusUrl, apiKey } = getCyrusTarget();
	const url = new URL("/api/sessions/stream", cyrusUrl);
	url.searchParams.set("key", apiKey);

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");

	const options = {
		hostname: url.hostname,
		port: url.port || 3456,
		path: `${url.pathname}?${url.searchParams}`,
		method: "GET",
	};
	const proxyReq = http.request(options, (proxyRes) => {
		proxyRes.pipe(res);
	});
	proxyReq.on("error", (err) => {
		res.write(
			`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`,
		);
		res.end();
	});
	proxyReq.end();

	req.on("close", () => proxyReq.destroy());
});

// ─── Fallback to index.html for SPA ──────────────────────────────────────────

app.get("*", (_req, res) => {
	const indexPath = path.join(distPath, "index.html");
	if (fs.existsSync(indexPath)) {
		res.sendFile(indexPath);
	} else {
		res.status(404).send("Dashboard not built. Run `pnpm build` first.");
	}
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.DASHBOARD_PORT ?? 3457);
app.listen(PORT, () => {
	console.log(`Cyrus Dashboard backend running at http://localhost:${PORT}`);
});
