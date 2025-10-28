import type { ApiResponse, RepositoryPayload } from "../types.js";
/**
 * Handle repository cloning or verification
 * - Clones repositories to ~/.cyrus/repos/<repo-name>
 * - If repository exists, verify it's a git repo and do nothing
 * - If repository doesn't exist, clone it to ~/.cyrus/repos/<repo-name>
 */
export declare function handleRepository(
	payload: RepositoryPayload,
	cyrusHome: string,
): Promise<ApiResponse>;
//# sourceMappingURL=repository.d.ts.map
