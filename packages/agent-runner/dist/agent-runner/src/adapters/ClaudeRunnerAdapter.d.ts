import type {
	ClaudeRunnerAdapterConfig,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
export declare class ClaudeRunnerAdapter implements Runner {
	private readonly config;
	private runner;
	private listenersRegistered;
	constructor(config: ClaudeRunnerAdapterConfig);
	private registerListeners;
	start(onEvent: (event: RunnerEvent) => void): Promise<RunnerStartResult>;
	stop(): Promise<void>;
}
//# sourceMappingURL=ClaudeRunnerAdapter.d.ts.map
