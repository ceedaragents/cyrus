import type { ApiResponse, CyrusConfigPayload } from "../types.js";
/**
 * Handle Cyrus configuration update
 * Updates the ~/.cyrus/config.json file with the provided configuration
 */
export declare function handleCyrusConfig(
	payload: CyrusConfigPayload,
	cyrusHome: string,
): Promise<ApiResponse>;
/**
 * Read current Cyrus configuration
 */
export declare function readCyrusConfig(cyrusHome: string): any;
//# sourceMappingURL=cyrusConfig.d.ts.map
