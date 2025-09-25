import type {
	OpenCodeRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
export declare class OpenCodeRunnerAdapter implements Runner {
	private readonly config;
	private sessionId?;
	private abortController?;
	private streamTask?;
	private stopped;
	private completed;
	constructor(config: OpenCodeRunnerOptions);
	start(onEvent: (event: RunnerEvent) => void): Promise<RunnerStartResult>;
	stop(): Promise<void>;
	private normalizeServerUrl;
	private ensureAuth;
	private createSession;
	private sendCommand;
	private consumeEvents;
	private streamOnce;
	private processSseBuffer;
	private handleSseEvent;
	private parseSseEvent;
	private extractTextParts;
	private extractToolEvents;
	private emitCompletion;
}
//# sourceMappingURL=OpenCodeRunnerAdapter.d.ts.map
