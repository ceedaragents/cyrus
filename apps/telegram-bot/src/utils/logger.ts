export class Logger {
	info(message: string): void {
		console.log(`[${new Date().toISOString()}] ${message}`);
	}

	error(message: string): void {
		console.error(`[${new Date().toISOString()}] ERROR ${message}`);
	}

	debug(message: string): void {
		if (process.env.CYRUS_LOG_LEVEL === "DEBUG") {
			console.log(`[${new Date().toISOString()}] DEBUG ${message}`);
		}
	}
}
