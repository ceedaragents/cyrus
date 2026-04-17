import { hostname } from "node:os";
import { type DiagLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
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
import type { OtelLogSinkOptions } from "./OtelLogSink.js";

const DEFAULT_SERVICE_NAME = "cyrus";
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3000;

/**
 * Options accepted by {@link initTelemetry}.
 *
 * Superset of the persisted {@link TelemetryConfigOptions} (the Zod-derived
 * type exported from `config-schemas.ts`) plus test-only knobs that cannot
 * be set from `config.json`. Standard OTEL_* env vars take precedence over
 * these fields; when neither is set, telemetry is disabled (no-op).
 */
export interface TelemetryInitOptions {
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
	 * Minimum log severity forwarded to OTel. Records below this threshold
	 * are dropped at the sink. Defaults to WARN to keep export volume bounded.
	 * Accepts either a {@link LogLevel} enum value or the matching string
	 * (`"DEBUG" | "INFO" | "WARN" | "ERROR"`) for config-file friendliness.
	 */
	minLogLevel?: LogLevel | "DEBUG" | "INFO" | "WARN" | "ERROR";

	/**
	 * Timeout (ms) for the final flush + shutdown performed by
	 * {@link shutdownTelemetry}. Prevents the process from hanging if the
	 * OTel backend is unreachable at exit. Defaults to 3000.
	 */
	shutdownTimeoutMs?: number;

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

/**
 * @deprecated Renamed to {@link TelemetryInitOptions}. Kept as an alias so
 * external imports don't break; the name will be removed in a future release.
 */
export type TelemetryConfig = TelemetryInitOptions;

let provider: LoggerProvider | undefined;
let diagInstalled = false;
let defaultSinkOptions: OtelLogSinkOptions = {};
let shutdownTimeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS;

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

function resolveEndpoint(config: TelemetryInitOptions): string | undefined {
	return (
		config.endpoint ??
		process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT
	);
}

function resolveEnabled(config: TelemetryInitOptions): boolean {
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

function resolveMinLogLevel(
	value: TelemetryInitOptions["minLogLevel"],
): LogLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	switch (value) {
		case "DEBUG":
			return LogLevel.DEBUG;
		case "INFO":
			return LogLevel.INFO;
		case "WARN":
			return LogLevel.WARN;
		case "ERROR":
			return LogLevel.ERROR;
		default:
			return undefined;
	}
}

function buildResourceAttributes(
	config: TelemetryInitOptions,
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
 *
 * Note: a `true` return means the provider is *configured* — OTLP export is
 * asynchronous, so transport errors surface later via the installed diag logger.
 */
export function initTelemetry(config: TelemetryInitOptions = {}): boolean {
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

	const resolvedMinLevel = resolveMinLogLevel(config.minLogLevel);
	defaultSinkOptions =
		resolvedMinLevel !== undefined ? { minLogLevel: resolvedMinLevel } : {};
	shutdownTimeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
	return true;
}

/**
 * Options used by {@link Logger} when it constructs a default OtelLogSink.
 * Mirrors whatever was passed to {@link initTelemetry}; re-exported so the
 * Logger does not need its own copy of configuration state.
 */
export function getDefaultOtelSinkOptions(): OtelLogSinkOptions {
	return defaultSinkOptions;
}

async function raceWithTimeout(
	action: () => Promise<void>,
	timeoutMs: number,
	label: string,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	try {
		const result = await Promise.race([
			action().then(() => "done" as const),
			timeout,
		]);
		if (result === "timeout") {
			diag.warn(
				`${label} did not complete within ${timeoutMs}ms; continuing shutdown`,
			);
		}
	} catch (error) {
		diag.warn(
			`${label} threw during shutdown: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Flush any buffered log records and shut down the telemetry provider.
 *
 * Should be called during graceful shutdown so that pending records are
 * transmitted before the process exits. Each phase is time-bounded
 * (see {@link TelemetryInitOptions.shutdownTimeoutMs}) so an unreachable
 * OTel backend cannot block process exit.
 */
export async function shutdownTelemetry(): Promise<void> {
	if (!provider) {
		return;
	}
	const current = provider;
	const timeout = shutdownTimeoutMs;
	provider = undefined;
	try {
		await raceWithTimeout(() => current.forceFlush(), timeout, "forceFlush");
	} finally {
		await raceWithTimeout(
			() => current.shutdown(),
			timeout,
			"provider.shutdown",
		);
		logs.disable();
		if (diagInstalled) {
			diag.disable();
			diagInstalled = false;
		}
		defaultSinkOptions = {};
		shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS;
	}
}

/**
 * Return true iff `initTelemetry` has successfully registered a provider.
 * Primarily used by the Logger to skip attribute serialisation when disabled.
 */
export function isTelemetryActive(): boolean {
	return provider !== undefined;
}
