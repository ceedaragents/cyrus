import type { ApiResponse, CyrusEnvPayload } from "../types.js";
/**
 * Handle Cyrus environment variables update
 * Primarily used to update/provide the Claude API token
 */
export declare function handleCyrusEnv(
	payload: CyrusEnvPayload,
	cyrusHome: string,
): Promise<ApiResponse>;
//# sourceMappingURL=cyrusEnv.d.ts.map
