import { EventEmitter } from "node:events";
import type {
	IAgentRunnerFactory,
	IInputEvent,
	IInputSource,
	IOrchestrator,
	IOrchestratorEvents,
	IOrchestratorSession,
	IOutputRenderer,
	IRoutingConfig,
} from "@cyrus/abstractions";

export class Orchestrator extends EventEmitter implements IOrchestrator {
	private inputSources: Map<string, IInputSource> = new Map();
	private renderers: Map<string, IOutputRenderer> = new Map();
	private agentFactory?: IAgentRunnerFactory;
	private sessions: Map<string, IOrchestratorSession> = new Map();
	private routingConfig: IRoutingConfig = {};
	private running = false;

	addInputSource(name: string, source: IInputSource<IInputEvent>): void {
		this.inputSources.set(name, source);
		source.on("event", async (event) => {
			this.emit("event:received", event, name);
			await this.handleInputEvent(event, name);
		});
		source.on("error", (error) => {
			this.emit("error", error, { source: name });
		});
	}

	removeInputSource(name: string): void {
		const source = this.inputSources.get(name);
		if (source) {
			// Remove all our listeners
			source.off("event", () => {});
			source.off("error", () => {});
			this.inputSources.delete(name);
		}
	}

	getInputSource(name: string): IInputSource<IInputEvent> | undefined {
		return this.inputSources.get(name);
	}

	addOutputRenderer(name: string, renderer: IOutputRenderer): void {
		this.renderers.set(name, renderer);
	}

	removeOutputRenderer(name: string): void {
		this.renderers.delete(name);
	}

	getOutputRenderer(name: string): IOutputRenderer | undefined {
		return this.renderers.get(name);
	}

	setAgentRunnerFactory(factory: IAgentRunnerFactory): void {
		this.agentFactory = factory;
	}

	getAgentRunnerFactory(): IAgentRunnerFactory | undefined {
		return this.agentFactory;
	}

	setRoutingConfig(config: IRoutingConfig): void {
		this.routingConfig = config;
	}

	getRoutingConfig(): IRoutingConfig {
		return this.routingConfig;
	}

	async start(): Promise<void> {
		if (!this.agentFactory) {
			throw new Error("Agent runner factory must be set before starting");
		}

		for (const renderer of this.renderers.values()) {
			await renderer.initialize();
		}

		for (const source of this.inputSources.values()) {
			await source.connect();
		}

		this.running = true;
		this.emit("started");
	}

	async stop(): Promise<void> {
		for (const source of this.inputSources.values()) {
			await source.disconnect();
		}

		for (const renderer of this.renderers.values()) {
			await renderer.shutdown();
		}

		this.running = false;
		this.emit("stopped");
	}

	isRunning(): boolean {
		return this.running;
	}

	getSession(sessionId: string): IOrchestratorSession | undefined {
		return this.sessions.get(sessionId);
	}

	getAllSessions(): IOrchestratorSession[] {
		return Array.from(this.sessions.values());
	}

	private async handleInputEvent(
		event: IInputEvent,
		_sourceName: string,
	): Promise<void> {
		try {
			const rendererName = this.selectRenderer(event);
			const renderer = this.renderers.get(rendererName);
			if (!renderer) {
				throw new Error(`No renderer found for event: ${event.type}`);
			}

			const rendererSession = await renderer.createSession({
				taskId: event.id,
				title: `Task from ${event.source}`,
				description: JSON.stringify(event.data).substring(0, 100),
			});

			const agentRunner = await this.agentFactory!.create({
				type: "claude",
				cyrusHome: process.cwd(),
			});

			const session: IOrchestratorSession = {
				id: event.id,
				inputEvent: event,
				agentRunner,
				rendererSession,
				startedAt: new Date(),
				status: "created",
			};

			this.sessions.set(session.id, session);
			this.emit("session:created", session);

			session.status = "running";
			this.emit("session:started", session);

			await agentRunner.start(`Process event: ${event.type}`);

			session.status = "completed";
			session.endedAt = new Date();
			this.emit("session:completed", session);
		} catch (error) {
			const session = this.sessions.get(event.id);
			if (session) {
				session.status = "failed";
				session.error = error as Error;
				session.endedAt = new Date();
				this.emit("session:failed", session, error as Error);
			}
			this.emit("error", error as Error, { event });
		}
	}

	private selectRenderer(event: IInputEvent): string {
		if (this.routingConfig.routes) {
			for (const route of this.routingConfig.routes) {
				if (this.matchesRoute(event, route)) {
					return route.renderer;
				}
			}
		}
		return this.routingConfig.defaultRenderer || "default";
	}

	private matchesRoute(event: IInputEvent, route: any): boolean {
		if (route.eventType && !this.matchesPattern(event.type, route.eventType)) {
			return false;
		}
		if (
			route.eventSource &&
			!this.matchesPattern(event.source, route.eventSource)
		) {
			return false;
		}
		if (route.condition && !route.condition(event)) {
			return false;
		}
		return true;
	}

	private matchesPattern(value: string, pattern: string): boolean {
		const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
		return regex.test(value);
	}

	on<K extends keyof IOrchestratorEvents>(
		event: K,
		handler: IOrchestratorEvents[K],
	): this {
		return super.on(event, handler as any);
	}

	off<K extends keyof IOrchestratorEvents>(
		event: K,
		handler: IOrchestratorEvents[K],
	): this {
		return super.off(event, handler as any);
	}

	once<K extends keyof IOrchestratorEvents>(
		event: K,
		handler: IOrchestratorEvents[K],
	): this {
		return super.once(event, handler as any);
	}
}
