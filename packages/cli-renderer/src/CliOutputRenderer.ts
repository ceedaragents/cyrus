import { EventEmitter } from "node:events";
import type {
	IOutputRenderer,
	IOutputRendererEvents,
	IRendererSession,
	ISessionContext,
	RendererCapability,
} from "@cyrus/abstractions";
import { CliRendererSession } from "./CliRendererSession.js";

export class CliOutputRenderer extends EventEmitter implements IOutputRenderer {
	readonly name: string;
	readonly type = "cli";
	readonly capabilities: readonly RendererCapability[] = [
		"text-output",
		"rich-formatting",
		"interactive-input",
		"activity-tracking",
		"real-time-updates",
		"persistence",
	];

	private sessions: Map<string, CliRendererSession> = new Map();
	private isInitialized = false;

	constructor(name: string) {
		super();
		this.name = name;
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
		const session = new CliRendererSession(context);
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
