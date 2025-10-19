import { EventEmitter } from "node:events";
import type {
	IInputEvent,
	IInputSource,
	IInputSourceEvents,
	IStatusUpdate,
} from "@cyrus/abstractions";
import { LinearWebhookClient } from "cyrus-linear-webhook-client";

export class LinearInputSource
	extends EventEmitter
	implements IInputSource<IInputEvent>
{
	readonly name: string;
	readonly type = "webhook";
	private client: LinearWebhookClient;
	private connected = false;

	constructor(name: string, config: any) {
		super();
		this.name = name;
		this.client = new LinearWebhookClient(config);

		this.client.on("webhook", (data: any) => {
			const event: IInputEvent = {
				id: data.webhookId || Math.random().toString(36),
				type: data.type || "webhook",
				timestamp: new Date(data.createdAt || Date.now()),
				data,
				source: "linear",
			};
			this.emit("event", event);
		});

		this.client.on("error", (error: Error) => {
			this.emit("error", error);
		});
	}

	async connect(): Promise<void> {
		await this.client.connect();
		this.connected = true;
		this.emit("connect");
	}

	async disconnect(): Promise<void> {
		await this.client.disconnect();
		this.connected = false;
		this.emit("disconnect");
	}

	isConnected(): boolean {
		return this.connected;
	}

	async sendStatus(_update: IStatusUpdate): Promise<void> {
		// No-op for webhook input
	}

	on<K extends keyof IInputSourceEvents<IInputEvent>>(
		event: K,
		handler: IInputSourceEvents<IInputEvent>[K],
	): this {
		return super.on(event, handler as any);
	}

	off<K extends keyof IInputSourceEvents<IInputEvent>>(
		event: K,
		handler: IInputSourceEvents<IInputEvent>[K],
	): this {
		return super.off(event, handler as any);
	}

	once<K extends keyof IInputSourceEvents<IInputEvent>>(
		event: K,
		handler: IInputSourceEvents<IInputEvent>[K],
	): this {
		return super.once(event, handler as any);
	}
}
