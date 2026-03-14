export async function upsertRepository(
	id: string,
	repo: Record<string, unknown>,
): Promise<void> {
	const res = await fetch(`/api/repositories/${encodeURIComponent(id)}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(repo),
	});
	if (!res.ok) throw new Error("Failed to save repository");
}

export async function deleteRepository(id: string): Promise<void> {
	const res = await fetch(`/api/repositories/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!res.ok) throw new Error("Failed to delete repository");
}
