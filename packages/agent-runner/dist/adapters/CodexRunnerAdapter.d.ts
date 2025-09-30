import type {
	CodexRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
export declare class CodexRunnerAdapter implements Runner {
	private readonly config;
	private child?;
	private finalDelivered;
	constructor(config: CodexRunnerOptions);
	start(onEvent: (event: RunnerEvent) => void): Promise<RunnerStartResult>;
	stop(): Promise<void>;
	private handleStdoutLine;
	private emitThought;
	private emitResponse;
	private emitFinal;
	private emitAction;
	private emitError;
	private emitLog;
	private isFinalMessage;
	private isToolEvent;
	private isLogEvent;
	private hasErrorField;
	private resemblesThought;
	private extractToolName;
	private extractToolDetail;
	private findToolPayload;
	private extractText;
}
//# sourceMappingURL=CodexRunnerAdapter.d.ts.map
