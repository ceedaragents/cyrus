import { hostname } from "node:os";
import { type DiagLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
	type LogRecordProcessor,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { LogLevel } from "./ILogger.js";

const DEFAULT_SERVICE_NAME = "cyrus";

/**
 * Telemetry configuration.
 *
 * Controls the OpenTelemetry logs sink that runs alongside the existing
 * stdout/stderr logger. Standard OTEL_* env vars take precedence over
 * these fields; when neither is set, telemetry is disabled (no-op).
 */
export interface TelemetryConfig {
	/**
	 * Whether telemetry is enabled. When false, no OTel provider is registered.
	 * Defaults to true if an endpoint (via config or OTEL_EXPORTER_OTLP_*)
	 * is resolvable, false otherwise.
	 */
	enabled?: boolean;

	/** `service.name` resource attribute. Falls back to `OTEL_SERVICE_NAME` or "cyrus". */
	serviceName?: string;

	/** `service.version` resource attribute. Typically the Cyrus CLI version. */
	serviceVersion?: string;

	/**
	 * OTLP/HTTP endpoint for log records.
	 * Falls back to `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` then
	 * `OTEL_EXPORTER_OTLP_ENDPOINT`.
	 */
	endpoint?: string;

	/**
	 * Additional HTTP headers forwarded with each OTLP request.
	 * Merged on top of `OTEL_EXPORTER_OTLP_HEADERS` / `OTEL_EXPORTER_OTLP_LOGS_HEADERS`.
	 */
	headers?: Record<string, string>;

	/**
	 * Extra resource attributes merged into the OTel Resource.
	 * Useful for `deployment.environment`, custom tags, etc.
	 */
	resourceAttributes?: Record<string, string>;

	/**
	 * Use synchronous SimpleLogRecordProcessor instead of BatchLogRecordProcessor.
	 * Exposed primarily for tests — production should use the batch processor.
	 */
	useSimpleProcessor?: boolean;

	/**
	 * Replace the default OTLP/HTTP exporter with a custom processor
	 * (e.g. InMemoryLogRecordExporter for tests).
	 */
	processor?: LogRecordProcessor;
}

let provider: LoggerProvider | undefined;
let diagInstalled = false;

/**
 * Parse the standard `OTEL_LOG_LEVEL` env var into a `DiagLogLevel`.
 * Defaults to WARN so transient export successes stay quiet but auth/network
 * failures bubble up to the operator.
 */
function resolveDiagLevel(): DiagLogLevel {
	const envLevel = process.env.OTEL_LOG_LEVEL?.toUpperCase();
	switch (envLevel) {
		case "NONE":
			return DiagLogLevel.NONE;
		case "ERROR":
			return DiagLogLevel.ERROR;
		case "WARN":
			return DiagLogLevel.WARN;
		case "INFO":
			return DiagLogLevel.INFO;
		case "DEBUG":
			return DiagLogLevel.DEBUG;
		case "VERBOSE":
			return DiagLogLevel.VERBOSE;
		case "ALL":
			return DiagLogLevel.ALL;
		default:
			return DiagLogLevel.WARN;
	}
}

/**
 * A DiagLogger that writes directly to the standard console streams.
 *
 * Deliberately does NOT route through our `ILogger` — that logger emits to the
 * OTel sink, which would create a feedback loop when the exporter itself fails
 * (failed export → diag.error → logger.error → exporter → failed export → …).
 */
function createConsoleDiagLogger(): DiagLogger {
	const prefix = "[OTel]";
	return {
		verbose: (msg, ...args) => console.debug(`${prefix} ${msg}`, ...args),
		debug: (msg, ...args) => console.debug(`${prefix} ${msg}`, ...args),
		info: (msg, ...args) => console.log(`${prefix} ${msg}`, ...args),
		warn: (msg, ...args) => console.warn(`${prefix} ${msg}`, ...args),
		error: (msg, ...args) => console.error(`${prefix} ${msg}`, ...args),
	};
}

/**
 * Map an internal LogLevel to the OTel SeverityNumber.
 */
export function severityNumberFor(level: LogLevel): SeverityNumber {
	switch (level) {
		case LogLevel.DEBUG:
			return SeverityNumber.DEBUG;
		case LogLevel.INFO:
			return SeverityNumber.INFO;
		case LogLevel.WARN:
			return SeverityNumber.WARN;
		case LogLevel.ERROR:
			return SeverityNumber.ERROR;
		default:
			return SeverityNumber.UNSPECIFIED;
	}
}

export function severityTextFor(level: LogLevel): string {
	switch (level) {
		case LogLevel.DEBUG:
			return "DEBUG";
		case LogLevel.INFO:
			return "INFO";
		case LogLevel.WARN:
			return "WARN";
		case LogLevel.ERROR:
			return "ERROR";
		default:
			return "UNSPECIFIED";
	}
}

function resolveEndpoint(config: TelemetryConfig): string | undefined {
	return (
		config.endpoint ??
		process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT
	);
}

function resolveEnabled(config: TelemetryConfig): boolean {
	if (process.env.OTEL_SDK_DISABLED === "true") {
		return false;
	}
	if (config.enabled === false) {
		return false;
	}
	if (config.enabled === true) {
		return true;
	}
	return Boolean(resolveEndpoint(config)) || Boolean(config.processor);
}

function buildResourceAttributes(
	config: TelemetryConfig,
): Record<string, string> {
	const attrs: Record<string, string> = {
		[ATTR_SERVICE_NAME]:
			config.serviceName ??
			process.env.OTEL_SERVICE_NAME ??
			DEFAULT_SERVICE_NAME,
		"host.name": hostname(),
	};
	if (config.serviceVersion) {
		attrs[ATTR_SERVICE_VERSION] = config.serviceVersion;
	}
	if (config.resourceAttributes) {
		Object.assign(attrs, config.resourceAttributes);
	}
	return attrs;
}

/**
 * Initialise the OpenTelemetry Logs SDK and register it as the global provider.
 *
 * Safe to call multiple times — subsequent calls replace the existing provider
 * (previous one is shut down). Returns `true` if a provider was registered,
 * `false` if telemetry is disabled.
 */
export function initTelemetry(config: TelemetryConfig = {}): boolean {
	if (!resolveEnabled(config)) {
		return false;
	}

	// Tear down previous provider (idempotent initialisation).
	if (provider) {
		void provider.shutdown().catch(() => {});
		provider = undefined;
	}

	// Surface exporter auth/network errors that would otherwise be swallowed
	// by BatchLogRecordProcessor's background retries.
	if (!diagInstalled) {
		diag.setLogger(createConsoleDiagLogger(), resolveDiagLevel());
		diagInstalled = true;
	}

	const resource = resourceFromAttributes(buildResourceAttributes(config));

	let processor = config.processor;
	if (!processor) {
		const exporter = new OTLPLogExporter({
			url: resolveEndpoint(config),
			headers: config.headers,
		});
		processor = config.useSimpleProcessor
			? new SimpleLogRecordProcessor(exporter)
			: new BatchLogRecordProcessor(exporter);
	}

	provider = new LoggerProvider({
		resource,
		processors: [processor],
	});

	logs.setGlobalLoggerProvider(provider);
	return true;
}

/**
 * Flush any buffered log records and shut down the telemetry provider.
 *
 * Should be called during graceful shutdown so that pending records are
 * transmitted before the process exits.
 */
export async function shutdownTelemetry(): Promise<void> {
	if (!provider) {
		return;
	}
	const current = provider;
	provider = undefined;
	try {
		await current.forceFlush();
	} finally {
		await current.shutdown();
		logs.disable();
		if (diagInstalled) {
			diag.disable();
			diagInstalled = false;
		}
	}
}

/**
 * Return true iff `initTelemetry` has successfully registered a provider.
 * Primarily used by the Logger to skip attribute serialisation when disabled.
 */
export function isTelemetryActive(): boolean {
	return provider !== undefined;
}
