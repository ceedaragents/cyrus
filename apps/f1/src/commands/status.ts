import { getRPCUrl, rpc } from "../client/RPCClient.js";
import type { ServerStatus } from "../types/index.js";
import { c } from "../utils/colors.js";

/**
 * Status command - Get server status and version
 */
export async function status(): Promise<void> {
	console.log(c.info("\n📊 Fetching server status...\n"));

	const result = await rpc<ServerStatus>("status", {}, { silent: false });

	if (result.success && result.data) {
		console.log(c.success("✅ Server Status\n"));
		console.log(`   ${c.bold("Version:")} ${c.value(result.data.version)}`);
		console.log(`   ${c.bold("Platform:")} ${c.value(result.data.platform)}`);
		console.log(`   ${c.bold("Mode:")} ${c.value(result.data.mode)}`);
		console.log(
			`   ${c.bold("Uptime:")} ${c.value(result.data.uptime || "N/A")}`,
		);
		console.log(`   ${c.bold("URL:")} ${c.url(getRPCUrl())}\n`);
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Version command - Show server version
 */
export async function version(): Promise<void> {
	const result = await rpc<ServerStatus>("status", {}, { silent: true });

	if (result.success && result.data) {
		console.log(c.value(result.data.version));
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
