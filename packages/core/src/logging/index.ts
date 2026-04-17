export type { ILogger, LogContext } from "./ILogger.js";
export { LogLevel } from "./ILogger.js";
export { createLogger } from "./Logger.js";
export {
	initTelemetry,
	isTelemetryActive,
	severityNumberFor,
	severityTextFor,
	shutdownTelemetry,
	type TelemetryConfig,
} from "./telemetry.js";
