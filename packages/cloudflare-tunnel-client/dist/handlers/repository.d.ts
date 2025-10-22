import type { ApiResponse, RepositoryPayload } from "../types.js";
/**
 * Handle repository cloning or verification
 * - If repository exists at path, verify it's a git repo and do nothing
 * - If repository doesn't exist, clone it to the specified path
 */
export declare function handleRepository(
	payload: RepositoryPayload,
): Promise<ApiResponse>;
//# sourceMappingURL=repository.d.ts.map
