import { rpc } from "../client/RPCClient.js";
import { c } from "../utils/colors.js";
import { printJSON } from "../utils/formatter.js";

/**
 * Get the entire in-memory state (for debugging)
 */
export async function getState(): Promise<void> {
	const result = await rpc("getState", {});

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
