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
export type { ILogger, LogContext } from "./ILogger.js";
export { LogLevel } from "./ILogger.js";
export { createLogger } from "./Logger.js";
export type { EventRecord, LogRecord, LogSink } from "./LogSink.js";
export { OtelLogSink, type OtelLogSinkOptions } from "./OtelLogSink.js";
export {
	initTelemetry,
	isTelemetryActive,
	severityNumberFor,
	severityTextFor,
	shutdownTelemetry,
	type TelemetryConfig,
	type TelemetryInitOptions,
} from "./telemetry.js";
