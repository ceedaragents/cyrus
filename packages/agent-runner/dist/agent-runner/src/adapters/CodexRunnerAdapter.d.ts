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
	private emitCommandAction;
	private emitError;
	private emitLog;
	private isTelemetryType;
	private isTelemetryItemType;
	private isErrorPayload;
	private extractItem;
	private extractItemType;
	private isItemFailure;
	private extractCommandName;
	private extractCommandDetail;
	private safeJsonStringify;
	private sanitizeAssistantText;
	private extractText;
}
//# sourceMappingURL=CodexRunnerAdapter.d.ts.map
