import { EventEmitter } from "node:events";
import type {
	IOutputRenderer,
	IOutputRendererEvents,
	IRendererSession,
	ISessionContext,
	RendererCapability,
} from "@cyrus/abstractions";
import { LinearClient } from "@linear/sdk";
import { LinearRendererSession } from "./LinearRendererSession.js";

export class LinearOutputRenderer
	extends EventEmitter
	implements IOutputRenderer
{
	readonly name: string;
	readonly type = "linear";
	readonly capabilities: readonly RendererCapability[] = [
		"text-output",
		"rich-formatting",
		"activity-tracking",
		"threading",
		"real-time-updates",
		"persistence",
	];

	private client: LinearClient;
	private sessions: Map<string, LinearRendererSession> = new Map();
	private isInitialized = false;

	constructor(name: string, apiToken: string) {
		super();
		this.name = name;
		this.client = new LinearClient({ accessToken: apiToken });
	}

	async initialize(): Promise<void> {
		this.isInitialized = true;
		this.emit("initialized");
	}

	async shutdown(): Promise<void> {
		for (const session of this.sessions.values()) {
			await session.close?.();
		}
		this.sessions.clear();
		this.isInitialized = false;
		this.emit("shutdown");
	}

	async createSession(context: ISessionContext): Promise<IRendererSession> {
		const session = new LinearRendererSession(this.client, context);
		await session.initialize();
		this.sessions.set(session.id, session);
		this.emit("session:created", session);
		return session;
	}

	getSession(sessionId: string): IRendererSession | null {
		return this.sessions.get(sessionId) || null;
	}

	getAllSessions(): IRendererSession[] {
		return Array.from(this.sessions.values());
	}

	async destroySession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			await session.close?.();
			this.sessions.delete(sessionId);
			this.emit("session:destroyed", sessionId);
		}
	}

	hasCapability(capability: RendererCapability): boolean {
		return this.capabilities.includes(capability);
	}

	on<K extends keyof IOutputRendererEvents>(
		event: K,
		handler: IOutputRendererEvents[K],
	): this {
		return super.on(event, handler as any);
	}

	off<K extends keyof IOutputRendererEvents>(
		event: K,
		handler: IOutputRendererEvents[K],
	): this {
		return super.off(event, handler as any);
	}

	once<K extends keyof IOutputRendererEvents>(
		event: K,
		handler: IOutputRendererEvents[K],
	): this {
		return super.once(event, handler as any);
	}
}
