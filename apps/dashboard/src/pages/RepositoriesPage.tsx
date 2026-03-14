import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { getConfig, saveConfig } from "@/api/config";

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
		<div className="border rounded-md p-2 flex flex-wrap gap-1.5 min-h-[38px] bg-background">
			{value.map((tag) => (
				<span
					key={tag}
					className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs"
				>
					{tag}
					<button onClick={() => onChange(value.filter((t) => t !== tag))}>
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
				placeholder="Add…"
				className="flex-1 min-w-20 text-xs outline-none bg-transparent"
			/>
		</div>
	);
}

type LabelBranchEntry = { label: string; base: string; prefix: string };

function LabelBranchEditor({
	value = {},
	onChange,
}: {
	value?: Record<string, { base?: string; prefix?: string }>;
	onChange: (v: Record<string, { base?: string; prefix?: string }>) => void;
}) {
	const entries: LabelBranchEntry[] = Object.entries(value).map(
		([label, cfg]) => ({
			label,
			base: cfg.base ?? "",
			prefix: cfg.prefix ?? "",
		}),
	);

	const update = (entries: LabelBranchEntry[]) => {
		const obj: Record<string, { base?: string; prefix?: string }> = {};
		for (const e of entries)
			if (e.label)
				obj[e.label] = {
					base: e.base || undefined,
					prefix: e.prefix || undefined,
				};
		onChange(obj);
	};

	return (
		<div className="space-y-2">
			{entries.map((entry, i) => (
				<div key={i} className="flex gap-2 items-center">
					<input
						value={entry.label}
						onChange={(e) => {
							const next = [...entries];
							next[i] = { ...entry, label: e.target.value };
							update(next);
						}}
						placeholder="label"
						className="w-24 border rounded px-2 py-1 text-xs bg-background"
					/>
					<span className="text-muted-foreground text-xs">→</span>
					<input
						value={entry.base}
						onChange={(e) => {
							const next = [...entries];
							next[i] = { ...entry, base: e.target.value };
							update(next);
						}}
						placeholder="base branch"
						className="w-28 border rounded px-2 py-1 text-xs bg-background"
					/>
					<input
						value={entry.prefix}
						onChange={(e) => {
							const next = [...entries];
							next[i] = { ...entry, prefix: e.target.value };
							update(next);
						}}
						placeholder="prefix (e.g. hotfix/)"
						className="w-32 border rounded px-2 py-1 text-xs bg-background"
					/>
					<button
						onClick={() => update(entries.filter((_, j) => j !== i))}
						className="text-muted-foreground hover:text-destructive"
					>
						<X size={12} />
					</button>
				</div>
			))}
			<button
				onClick={() =>
					update([...entries, { label: "", base: "", prefix: "" }])
				}
				className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
			>
				<Plus size={12} /> Add rule
			</button>
		</div>
	);
}

type Repo = Record<string, unknown>;

function RepoSlideOver({
	repo,
	onClose,
	onSave,
}: {
	repo: Repo | null;
	onClose: () => void;
	onSave: (r: Repo) => void;
}) {
	const isNew = !repo?.id;
	const [form, setForm] = useState<Repo>(
		repo ?? { id: crypto.randomUUID(), isActive: true },
	);
	const set = (key: string, value: unknown) =>
		setForm((f) => ({ ...f, [key]: value }));

	const field = (
		key: string,
		label: string,
		opts?: { type?: string; placeholder?: string },
	) => (
		<div>
			<label className="block text-xs font-medium mb-1">{label}</label>
			<input
				type={opts?.type ?? "text"}
				value={(form[key] as string) ?? ""}
				onChange={(e) => set(key, e.target.value || undefined)}
				placeholder={opts?.placeholder}
				className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
			/>
		</div>
	);

	return (
		<div className="fixed inset-0 z-50 flex">
			<div className="flex-1 bg-black/40" onClick={onClose} />
			<div className="w-[520px] bg-background border-l shadow-xl overflow-y-auto flex flex-col">
				<div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-background z-10">
					<h2 className="font-semibold">
						{isNew ? "Add Repository" : "Edit Repository"}
					</h2>
					<button
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground"
					>
						<X size={18} />
					</button>
				</div>
				<div className="p-5 space-y-6 flex-1">
					{/* Identity */}
					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
							Identity
						</h3>
						<div className="space-y-2">
							{field("name", "Name")}
							{field("id", "ID")}
						</div>
					</section>

					{/* Git */}
					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
							Git
						</h3>
						<div className="space-y-2">
							{field("repositoryPath", "Repository path", {
								placeholder: "/path/to/repo",
							})}
							{field("baseBranch", "Base branch", { placeholder: "main" })}
							{field("workspaceBaseDir", "Workspace base dir", {
								placeholder: "/path/to/worktrees",
							})}
							{field("githubUrl", "GitHub URL", {
								placeholder: "https://github.com/org/repo",
							})}
						</div>
					</section>

					{/* Linear */}
					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
							Linear
						</h3>
						<div className="space-y-2">
							{field("linearWorkspaceId", "Workspace ID")}
							{field("linearWorkspaceName", "Workspace name")}
							{field("linearToken", "Token", { type: "password" })}
							{field("linearRefreshToken", "Refresh token", {
								type: "password",
							})}
							<div>
								<label className="block text-xs font-medium mb-1">
									Team keys
								</label>
								<TagInput
									value={form.teamKeys as string[]}
									onChange={(v) => set("teamKeys", v.length ? v : undefined)}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium mb-1">
									Routing labels
								</label>
								<TagInput
									value={form.routingLabels as string[]}
									onChange={(v) =>
										set("routingLabels", v.length ? v : undefined)
									}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium mb-1">
									Project keys
								</label>
								<TagInput
									value={form.projectKeys as string[]}
									onChange={(v) => set("projectKeys", v.length ? v : undefined)}
								/>
							</div>
						</div>
					</section>

					{/* Runner & Tools */}
					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
							Runner & Tools
						</h3>
						<div className="space-y-2">
							{field("model", "Model override", {
								placeholder: "e.g. claude-opus-4-5",
							})}
							{field("fallbackModel", "Fallback model")}
							<div>
								<label className="block text-xs font-medium mb-1">
									Allowed tools
								</label>
								<TagInput
									value={form.allowedTools as string[]}
									onChange={(v) =>
										set("allowedTools", v.length ? v : undefined)
									}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium mb-1">
									Disallowed tools
								</label>
								<TagInput
									value={form.disallowedTools as string[]}
									onChange={(v) =>
										set("disallowedTools", v.length ? v : undefined)
									}
								/>
							</div>
						</div>
					</section>

					{/* Label Branch Config */}
					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
							Label Branch Config
						</h3>
						<p className="text-xs text-muted-foreground mb-2">
							Map Linear labels to a base branch and/or branch name prefix.
						</p>
						<LabelBranchEditor
							value={
								form.labelBranchConfig as Record<
									string,
									{ base?: string; prefix?: string }
								>
							}
							onChange={(v) =>
								set("labelBranchConfig", Object.keys(v).length ? v : undefined)
							}
						/>
					</section>

					{/* Advanced */}
					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
							Advanced
						</h3>
						<div className="space-y-2">
							{field("mcpConfigPath", "MCP config path(s)", {
								placeholder: "/path/to/mcp.json",
							})}
							{field("promptTemplatePath", "Prompt template path")}
							<div>
								<label className="block text-xs font-medium mb-1">
									Append instruction
								</label>
								<textarea
									value={(form.appendInstruction as string) ?? ""}
									onChange={(e) =>
										set("appendInstruction", e.target.value || undefined)
									}
									rows={3}
									className="w-full border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
								/>
							</div>
							<div className="flex items-center gap-2">
								<input
									type="checkbox"
									id="isActive"
									checked={(form.isActive as boolean) ?? true}
									onChange={(e) => set("isActive", e.target.checked)}
									className="rounded"
								/>
								<label htmlFor="isActive" className="text-sm">
									Active
								</label>
							</div>
						</div>
					</section>
				</div>
				<div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-background">
					<button
						onClick={onClose}
						className="px-4 py-1.5 border rounded-md text-sm hover:bg-muted transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={() => onSave(form)}
						className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
					>
						Save
					</button>
				</div>
			</div>
		</div>
	);
}

export function RepositoriesPage() {
	const qc = useQueryClient();
	const { data: config, isLoading } = useQuery({
		queryKey: ["config"],
		queryFn: getConfig,
	});
	const [editingRepo, setEditingRepo] = useState<Repo | null | "new">(null);

	const repos: Repo[] =
		((config as Record<string, unknown>)?.repositories as Repo[]) ?? [];

	const saveMut = useMutation({
		mutationFn: async (repo: Repo) => {
			const current = (config as Record<string, unknown>) ?? {
				repositories: [],
			};
			const list: Repo[] = (current.repositories as Repo[]) ?? [];
			const idx = list.findIndex((r) => r.id === repo.id);
			const updated =
				idx >= 0
					? list.map((r) => (r.id === repo.id ? repo : r))
					: [...list, repo];
			await saveConfig({ ...current, repositories: updated });
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			setEditingRepo(null);
		},
	});

	const deleteMut = useMutation({
		mutationFn: async (id: string) => {
			const current = (config as Record<string, unknown>) ?? {
				repositories: [],
			};
			const updated = ((current.repositories as Repo[]) ?? []).filter(
				(r) => r.id !== id,
			);
			await saveConfig({ ...current, repositories: updated });
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
	});

	if (isLoading)
		return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

	return (
		<div className="p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-xl font-semibold">Repositories</h1>
					<p className="text-sm text-muted-foreground">
						{repos.length} configured
					</p>
				</div>
				<button
					onClick={() => setEditingRepo("new")}
					className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
				>
					<Plus size={14} /> Add Repository
				</button>
			</div>

			{repos.length === 0 ? (
				<div className="text-center py-16 text-muted-foreground text-sm">
					No repositories configured. Add one to get started.
				</div>
			) : (
				<div className="space-y-2">
					{repos.map((repo) => (
						<div
							key={repo.id as string}
							className="flex items-center gap-4 border rounded-lg px-4 py-3 bg-card hover:bg-muted/20 transition-colors"
						>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-medium text-sm">
										{repo.name as string}
									</span>
									{!(repo.isActive ?? true) && (
										<span className="text-xs text-muted-foreground">
											(inactive)
										</span>
									)}
								</div>
								<p className="text-xs text-muted-foreground truncate">
									{repo.repositoryPath as string}
								</p>
							</div>
							<div className="text-xs text-muted-foreground shrink-0">
								{repo.baseBranch as string}
							</div>
							<div className="text-xs text-muted-foreground shrink-0">
								{repo.linearWorkspaceName as string}
							</div>
							<div className="flex items-center gap-1">
								<button
									onClick={() => setEditingRepo(repo)}
									className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
								>
									<Pencil size={13} />
								</button>
								<button
									onClick={() => {
										if (confirm("Delete this repository?"))
											deleteMut.mutate(repo.id as string);
									}}
									className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
								>
									<Trash2 size={13} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{editingRepo !== null && (
				<RepoSlideOver
					repo={editingRepo === "new" ? null : editingRepo}
					onClose={() => setEditingRepo(null)}
					onSave={(r) => saveMut.mutate(r)}
				/>
			)}
		</div>
	);
}
