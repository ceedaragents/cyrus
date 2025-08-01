import {
	NdjsonClient as BaseNdjsonClient,
	type NdjsonClientConfig,
} from "cyrus-ndjson-client";

export class NdjsonClient extends BaseNdjsonClient {
	constructor(proxyUrl: string, edgeToken: string, webhookBaseUrl?: string) {
		const config: NdjsonClientConfig = {
			proxyUrl,
			token: edgeToken,
			transport: "webhook",
			webhookPort: 3000 + Math.floor(Math.random() * 1000),
			webhookPath: "/webhook",
			webhookHost: "localhost",
			name: `Electron-${process.platform}-${Date.now()}`,
			capabilities: ["linear-processing", "claude-execution"],
			...(webhookBaseUrl && { webhookBaseUrl }),
		};

		super(config);
	}

	// Add methods for backward compatibility
	isConnected(): boolean {
		return super.isConnected();
	}

	async disconnect(): Promise<void> {
		return super.disconnect();
	}

	// EventEmitter methods are inherited from BaseNdjsonClient
}
