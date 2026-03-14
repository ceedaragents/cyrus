import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getConfig, saveConfig } from "@/api/config";

type AccessControl = {
	allowedUsers?: string[];
	blockedUsers?: string[];
	blockBehavior?: "silent" | "message";
	blockMessage?: string;
};

function TagInput({
	value = [],
	onChange,
	placeholder,
}: {
	value?: string[];
	onChange: (v: string[]) => void;
	placeholder?: string;
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
				placeholder={placeholder ?? "Add and press Enter…"}
				className="flex-1 min-w-24 text-xs outline-none bg-transparent"
			/>
		</div>
	);
}

function AccessControlForm({
	title,
	value,
	onChange,
}: {
	title: string;
	value: AccessControl;
	onChange: (v: AccessControl) => void;
}) {
	const set = (key: keyof AccessControl, val: unknown) =>
		onChange({ ...value, [key]: val });

	return (
		<div className="border rounded-lg p-4 space-y-4">
			<h3 className="font-medium text-sm">{title}</h3>

			<div className="grid grid-cols-2 gap-4">
				<div>
					<label className="block text-xs font-medium mb-1">
						Allowed users
					</label>
					<p className="text-xs text-muted-foreground mb-1.5">
						User IDs or emails that can trigger sessions
					</p>
					<TagInput
						value={value.allowedUsers}
						onChange={(v) => set("allowedUsers", v.length ? v : undefined)}
						placeholder="user@example.com or user-id"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium mb-1">
						Blocked users
					</label>
					<p className="text-xs text-muted-foreground mb-1.5">
						Users explicitly denied access
					</p>
					<TagInput
						value={value.blockedUsers}
						onChange={(v) => set("blockedUsers", v.length ? v : undefined)}
						placeholder="user@example.com or user-id"
					/>
				</div>
			</div>

			<div>
				<label className="block text-xs font-medium mb-2">Block behavior</label>
				<div className="flex gap-4">
					{(["silent", "message"] as const).map((opt) => (
						<label
							key={opt}
							className="flex items-center gap-2 text-sm cursor-pointer"
						>
							<input
								type="radio"
								name={`blockBehavior-${title}`}
								value={opt}
								checked={(value.blockBehavior ?? "silent") === opt}
								onChange={() => set("blockBehavior", opt)}
							/>
							<span className="capitalize">{opt}</span>
							<span className="text-xs text-muted-foreground">
								{opt === "silent"
									? "— ignore the issue silently"
									: "— reply with block message"}
							</span>
						</label>
					))}
				</div>
			</div>

			{(value.blockBehavior ?? "silent") === "message" && (
				<div>
					<label className="block text-xs font-medium mb-1">
						Block message
					</label>
					<textarea
						value={value.blockMessage ?? ""}
						onChange={(e) => set("blockMessage", e.target.value || undefined)}
						rows={2}
						placeholder="Message to post when a blocked user triggers Cyrus…"
						className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
					/>
				</div>
			)}
		</div>
	);
}

export function AccessControlPage() {
	const qc = useQueryClient();
	const { data: config, isLoading } = useQuery({
		queryKey: ["config"],
		queryFn: getConfig,
	});
	const [local, setLocal] = useState<Record<string, unknown> | null>(null);
	const [saved, setSaved] = useState(false);

	const cfg = local ?? (config as Record<string, unknown> | undefined) ?? {};

	const globalAc: AccessControl = (cfg.accessControl as AccessControl) ?? {};

	const setGlobal = (v: AccessControl) =>
		setLocal({ ...cfg, accessControl: Object.keys(v).length ? v : undefined });

	const saveMut = useMutation({
		mutationFn: async () => saveConfig(cfg),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		},
	});

	if (isLoading)
		return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

	return (
		<div className="p-6 max-w-3xl">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-xl font-semibold">Access Control</h1>
					<p className="text-sm text-muted-foreground">
						Control which Linear users can trigger Cyrus sessions.
					</p>
				</div>
				<button
					onClick={() => saveMut.mutate()}
					disabled={saveMut.isPending}
					className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
				>
					{saved ? "Saved ✓" : saveMut.isPending ? "Saving…" : "Save"}
				</button>
			</div>

			<div className="space-y-6">
				<div>
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
						Global
					</h2>
					<p className="text-xs text-muted-foreground mb-3">
						Applies to all repositories unless overridden at the repository
						level. Leave both lists empty to allow all users.
					</p>
					<AccessControlForm
						title="Global access control"
						value={globalAc}
						onChange={setGlobal}
					/>
				</div>

				<div>
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
						Per-Repository
					</h2>
					<p className="text-xs text-muted-foreground mb-3">
						Repository-level access control overrides the global settings for
						that repository. Edit repository-specific access control from the{" "}
						<Link to="/repositories" className="text-primary hover:underline">
							Repositories
						</Link>{" "}
						page.
					</p>
					{((cfg.repositories as Array<Record<string, unknown>>) ?? [])
						.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No repositories configured.
						</p>
					) : (
						<div className="space-y-3">
							{((cfg.repositories as Array<Record<string, unknown>>) ?? []).map(
								(repo) => {
									const repoAc: AccessControl =
										(repo.accessControl as AccessControl) ?? {};
									const hasOverride =
										(repoAc.allowedUsers?.length ?? 0) > 0 ||
										(repoAc.blockedUsers?.length ?? 0) > 0;
									return (
										<div
											key={repo.id as string}
											className="flex items-center gap-3 border rounded-lg px-4 py-3"
										>
											<div className="flex-1">
												<span className="font-medium text-sm">
													{repo.name as string}
												</span>
												<p className="text-xs text-muted-foreground mt-0.5">
													{hasOverride
														? `${repoAc.allowedUsers?.length ?? 0} allowed, ${repoAc.blockedUsers?.length ?? 0} blocked`
														: "Inherits global settings"}
												</p>
											</div>
											<span
												className={`text-xs px-2 py-0.5 rounded ${hasOverride ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
											>
												{hasOverride ? "Override" : "Inherited"}
											</span>
										</div>
									);
								},
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
