export { ConsoleLogSink } from "./ConsoleLogSink.js";
export {
	type CyrusEvent,
	classifyError,
	type ErrorClass,
	type SessionCompletedEvent,
	type SessionFailedEvent,
	type SessionResumedEvent,
	type SessionStartedEvent,
	type SessionStoppedEvent,
} from "./events.js";
export { FanOutPipeline } from "./FanOutPipeline.js";
export type { ILogger, LogContext } from "./ILogger.js";
export {
	createLogger,
	type LoggerOptions,
	setDefaultLogPipeline,
	withLevelFilter,
} from "./Logger.js";
export { LogLevel } from "./LogLevel.js";
export type { LogPipeline, LogProcessor, LogSink } from "./LogPipeline.js";
export type {
	EventEntryRecord,
	LogBindings,
	LogEntryRecord,
	LogRecord,
} from "./LogRecord.js";
export { OtelLogSink } from "./OtelLogSink.js";
export { LevelFilterProcessor } from "./processors/LevelFilterProcessor.js";
export { RedactingProcessor } from "./processors/RedactingProcessor.js";
export {
	DefaultRedactionPolicy,
	type DefaultRedactionPolicyOptions,
} from "./redaction/DefaultRedactionPolicy.js";
export type { RedactionPolicy } from "./redaction/RedactionPolicy.js";
export {
	TelemetryRegistry,
	type TelemetryRegistryRuntimeOptions,
} from "./TelemetryRegistry.js";
