import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getConfig, getEnv, saveConfig, saveEnv } from "@/api/config";

function TagInput({
	value = [],
	onChange,
}: {
	value?: string[];
	onChange: (v: string[]) => void;
}) {
	const [input, setInput] = useState("");
	const add = () => {
		const t = input.trim();
		if (t && !value.includes(t)) onChange([...value, t]);
		setInput("");
	};
	return (
		<div className="border rounded-md p-2 flex flex-wrap gap-1.5 min-h-[42px] bg-background">
			{value.map((tag) => (
				<span
					key={tag}
					className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs"
				>
					{tag}
					<button
						onClick={() => onChange(value.filter((t) => t !== tag))}
						className="hover:text-destructive"
					>
						×
					</button>
				</span>
			))}
			<input
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === ",") {
						e.preventDefault();
						add();
					}
				}}
				onBlur={add}
				placeholder="Add and press Enter…"
				className="flex-1 min-w-24 text-xs outline-none bg-transparent"
			/>
		</div>
	);
}

const RUNNERS = ["claude", "gemini", "codex", "cursor"] as const;
const KNOWN_ENV_KEYS = [
	{
		key: "ANTHROPIC_API_KEY",
		label: "Anthropic API Key",
		hint: "Enables Claude runner",
	},
	{
		key: "CLAUDE_CODE_OAUTH_TOKEN",
		label: "Claude OAuth Token",
		hint: "Alternative to API key",
	},
	{
		key: "GEMINI_API_KEY",
		label: "Gemini API Key",
		hint: "Enables Gemini runner",
	},
	{ key: "LINEAR_CLIENT_ID", label: "Linear Client ID", hint: "" },
	{ key: "LINEAR_CLIENT_SECRET", label: "Linear Client Secret", hint: "" },
	{ key: "LINEAR_WEBHOOK_SECRET", label: "Linear Webhook Secret", hint: "" },
	{
		key: "CYRUS_BASE_URL",
		label: "Cyrus Base URL",
		hint: "Public URL for webhooks",
	},
	{ key: "CYRUS_SERVER_PORT", label: "Server Port", hint: "Default: 3456" },
	{
		key: "CLOUDFLARE_TOKEN",
		label: "Cloudflare Token",
		hint: "Optional tunnel token",
	},
	{ key: "CYRUS_API_KEY", label: "Cyrus API Key", hint: "Dashboard auth key" },
];

export function GlobalConfigPage() {
	const qc = useQueryClient();
	const { data: config, isLoading } = useQuery({
		queryKey: ["config"],
		queryFn: getConfig,
	});
	const { data: envData } = useQuery({ queryKey: ["env"], queryFn: getEnv });

	const [localConfig, setLocalConfig] = useState<Record<
		string,
		unknown
	> | null>(null);
	const [envValues, setEnvValues] = useState<Record<string, string>>({});
	const [saved, setSaved] = useState(false);

	const cfg =
		localConfig ?? (config as Record<string, unknown> | undefined) ?? {};

	const set = (key: string, value: unknown) =>
		setLocalConfig({ ...cfg, [key]: value });

	const saveMut = useMutation({
		mutationFn: async () => {
			await saveConfig(cfg);
			if (Object.keys(envValues).length > 0) await saveEnv(envValues);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["env"] });
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		},
	});

	if (isLoading)
		return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

	return (
		<div className="p-6 max-w-2xl">
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-xl font-semibold">Global Config</h1>
				<button
					onClick={() => saveMut.mutate()}
					disabled={saveMut.isPending}
					className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
				>
					{saved ? "Saved ✓" : saveMut.isPending ? "Saving…" : "Save"}
				</button>
			</div>

			<div className="space-y-8">
				{/* Runner */}
				<section>
					<h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
						Default Runner
					</h2>
					<div className="flex gap-2 flex-wrap">
						{RUNNERS.map((r) => (
							<button
								key={r}
								onClick={() => set("defaultRunner", r)}
								className={`px-3 py-1.5 rounded-md text-sm border transition-colors capitalize ${cfg.defaultRunner === r ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
							>
								{r}
							</button>
						))}
					</div>
					<p className="text-xs text-muted-foreground mt-1.5">
						Fallback when no runner label is set on the issue.
					</p>
				</section>

				{/* Models */}
				<section>
					<h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
						Models
					</h2>
					<div className="grid grid-cols-2 gap-3">
						{[
							{ key: "claudeDefaultModel", label: "Claude model" },
							{ key: "claudeDefaultFallbackModel", label: "Claude fallback" },
							{ key: "geminiDefaultModel", label: "Gemini model" },
							{ key: "codexDefaultModel", label: "Codex model" },
						].map(({ key, label }) => (
							<div key={key}>
								<label className="block text-xs font-medium mb-1">
									{label}
								</label>
								<input
									value={(cfg[key] as string) ?? ""}
									onChange={(e) => set(key, e.target.value || undefined)}
									placeholder="e.g. claude-opus-4-5"
									className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
						))}
					</div>
				</section>

				{/* Tools */}
				<section>
					<h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
						Default Tools
					</h2>
					<div className="space-y-3">
						<div>
							<label className="block text-xs font-medium mb-1">
								Allowed tools
							</label>
							<TagInput
								value={cfg.defaultAllowedTools as string[]}
								onChange={(v) => set("defaultAllowedTools", v)}
							/>
						</div>
						<div>
							<label className="block text-xs font-medium mb-1">
								Disallowed tools
							</label>
							<TagInput
								value={cfg.defaultDisallowedTools as string[]}
								onChange={(v) => set("defaultDisallowedTools", v)}
							/>
						</div>
					</div>
				</section>

				{/* Misc */}
				<section>
					<h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
						Misc
					</h2>
					<div className="space-y-3">
						<div className="flex items-center gap-3">
							<input
								type="checkbox"
								id="issueUpdateTrigger"
								checked={(cfg.issueUpdateTrigger as boolean) ?? true}
								onChange={(e) => set("issueUpdateTrigger", e.target.checked)}
								className="rounded"
							/>
							<label htmlFor="issueUpdateTrigger" className="text-sm">
								Trigger on issue title/description updates
							</label>
						</div>
						<div>
							<label className="block text-xs font-medium mb-1">
								Global setup script
							</label>
							<input
								value={(cfg.global_setup_script as string) ?? ""}
								onChange={(e) =>
									set("global_setup_script", e.target.value || undefined)
								}
								placeholder="/path/to/setup.sh"
								className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium mb-1">
								Ngrok auth token
							</label>
							<input
								type="password"
								value={(cfg.ngrokAuthToken as string) ?? ""}
								onChange={(e) =>
									set("ngrokAuthToken", e.target.value || undefined)
								}
								className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium mb-1">
								Linear workspace slug
							</label>
							<input
								value={(cfg.linearWorkspaceSlug as string) ?? ""}
								onChange={(e) =>
									set("linearWorkspaceSlug", e.target.value || undefined)
								}
								placeholder="e.g. mycompany"
								className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
					</div>
				</section>

				{/* Environment Variables */}
				<section>
					<h2 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wide">
						Environment Variables
					</h2>
					<p className="text-xs text-muted-foreground mb-3">
						Edits ~/.cyrus/.env directly. Masked fields are only updated when
						changed.
					</p>
					<div className="space-y-2">
						{KNOWN_ENV_KEYS.map(({ key, label, hint }) => {
							const existing = envData?.env?.[key];
							const isSecret = existing?.isSecret ?? true;
							return (
								<div key={key}>
									<label className="block text-xs font-medium mb-0.5">
										{label}{" "}
										{hint && (
											<span className="text-muted-foreground font-normal">
												— {hint}
											</span>
										)}
									</label>
									<input
										type={isSecret ? "password" : "text"}
										defaultValue={isSecret ? "" : (existing?.value ?? "")}
										placeholder={
											isSecret && existing
												? "••••••••  (leave blank to keep)"
												: ""
										}
										onChange={(e) =>
											setEnvValues((prev) => ({
												...prev,
												[key]: e.target.value,
											}))
										}
										className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
									/>
								</div>
							);
						})}
					</div>
				</section>
			</div>
		</div>
	);
}
