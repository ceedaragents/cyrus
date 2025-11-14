import { getRPCUrl, rpc } from "../client/RPCClient.js";
import { c } from "../utils/colors.js";

/**
 * Ping command - Check server connectivity
 */
export async function ping(): Promise<void> {
	console.log(c.info("\n🏓 Pinging Cyrus server...\n"));

	const result = await rpc("ping", {}, { silent: false });

	if (result.success) {
		console.log(c.success("✅ Server is responding"));
		console.log(c.dim(`   URL: ${getRPCUrl()}\n`));
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
