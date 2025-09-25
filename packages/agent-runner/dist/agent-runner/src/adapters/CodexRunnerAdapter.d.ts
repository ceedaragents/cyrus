import type {
	CodexRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
export declare class CodexRunnerAdapter implements Runner {
	private readonly config;
	private child?;
	constructor(config: CodexRunnerOptions);
	start(onEvent: (event: RunnerEvent) => void): Promise<RunnerStartResult>;
	stop(): Promise<void>;
}
//# sourceMappingURL=CodexRunnerAdapter.d.ts.map
