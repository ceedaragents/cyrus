import { hostname } from "node:os";
import { type DiagLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import type { LoggerProvider as LoggerProviderApi } from "@opentelemetry/api-logs";
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
import type { TelemetryConfig } from "../config-schemas.js";
import { LogLevel } from "./LogLevel.js";
import type { LogPipeline, LogSink } from "./LogPipeline.js";
import { OtelLogSink } from "./OtelLogSink.js";
import { LevelFilterProcessor } from "./processors/LevelFilterProcessor.js";

const DEFAULT_SERVICE_NAME = "cyrus";

/**
 * Per-instance construction options that extend what the persisted
 * `TelemetryConfig` (zod) expresses. These are runtime-only knobs — they
 * never appear in config.json because they are either supplied by the host
 * application (service version) or are test-only injection points.
 */
export interface TelemetryRegistryRuntimeOptions {
	/** `service.version` resource attribute, typically the CLI version. */
	serviceVersion?: string;
	/** Replace the default OTLP/HTTP exporter (used by tests with `InMemoryLogRecordExporter`). */
	processor?: LogRecordProcessor;
	/** Use the synchronous processor instead of batch; exposed for tests. */
	useSimpleProcessor?: boolean;
}

function resolveDiagLevel(env: NodeJS.ProcessEnv): DiagLogLevel {
	switch (env.OTEL_LOG_LEVEL?.toUpperCase()) {
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
 * Console-backed diag logger.
 *
 * Deliberately does NOT route through the Cyrus logging pipeline — that
 * pipeline ends at the OTel sink, and a failure in the OTel exporter calls
 * back into `diag.error`. Routing through the pipeline would create a
 * feedback loop of: failed export → diag.error → logger.error → exporter
 * → failed export → …
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

function resolveEndpoint(
	config: TelemetryConfig,
	env: NodeJS.ProcessEnv,
): string | undefined {
	return (
		config.endpoint ??
		env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
		env.OTEL_EXPORTER_OTLP_ENDPOINT
	);
}

function resolveEnabled(
	config: TelemetryConfig,
	runtime: TelemetryRegistryRuntimeOptions,
	env: NodeJS.ProcessEnv,
): boolean {
	if (env.OTEL_SDK_DISABLED === "true") return false;
	if (config.enabled === false) return false;
	if (config.enabled === true) return true;
	return Boolean(resolveEndpoint(config, env)) || Boolean(runtime.processor);
}

function resolveMinLogLevel(value: TelemetryConfig["minLogLevel"]): LogLevel {
	return LogLevel.parse(value) ?? LogLevel.WARN;
}

function buildResourceAttributes(
	config: TelemetryConfig,
	runtime: TelemetryRegistryRuntimeOptions,
	env: NodeJS.ProcessEnv,
): Record<string, string> {
	const attrs: Record<string, string> = {
		[ATTR_SERVICE_NAME]:
			config.serviceName ?? env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
		"host.name": hostname(),
	};
	if (runtime.serviceVersion) {
		attrs[ATTR_SERVICE_VERSION] = runtime.serviceVersion;
	}
	if (config.resourceAttributes) {
		Object.assign(attrs, config.resourceAttributes);
	}
	return attrs;
}

async function raceAbort<T>(
	action: () => Promise<T>,
	signal: AbortSignal,
	label: string,
): Promise<void> {
	if (signal.aborted) {
		diag.warn(`${label} aborted before start`);
		return;
	}
	const aborted = new Promise<"aborted">((resolve) => {
		const listener = () => resolve("aborted");
		signal.addEventListener("abort", listener, { once: true });
	});
	try {
		const result = await Promise.race([
			action().then(() => "done" as const),
			aborted,
		]);
		if (result === "aborted") {
			diag.warn(`${label} did not complete before abort; continuing shutdown`);
		}
	} catch (error) {
		diag.warn(
			`${label} threw during shutdown: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Owns an OpenTelemetry `LoggerProvider` and hands out sinks bound to it.
 *
 * Replaces the module-level singleton state of the previous implementation:
 * multiple registries can coexist (per tenant, per test), and the `Logger`
 * depends only on the `LogPipeline` interface rather than on OTel globals.
 *
 * The registry is itself a `LogPipeline` so it can be composed directly
 * into a fan-out alongside other sinks. Internally it wraps the raw OTel
 * sink in a `LevelFilterProcessor` for log records; events bypass the filter.
 */
export class TelemetryRegistry implements LogPipeline {
	private readonly minLogLevel: LogLevel;
	private readonly shutdownSignalSource: () => AbortSignal;
	private readonly diagCleanup: (() => void) | undefined;

	private constructor(
		private readonly provider: LoggerProvider,
		private readonly providerApi: LoggerProviderApi,
		opts: {
			minLogLevel: LogLevel;
			shutdownSignalSource: () => AbortSignal;
			diagCleanup: (() => void) | undefined;
		},
	) {
		this.minLogLevel = opts.minLogLevel;
		this.shutdownSignalSource = opts.shutdownSignalSource;
		this.diagCleanup = opts.diagCleanup;
	}

	/**
	 * Construct a registry from a validated config. Returns `undefined` when
	 * telemetry resolves to disabled (no endpoint, disabled flag, or the
	 * `OTEL_SDK_DISABLED` env var is set) — callers should fall back to
	 * stdout-only logging in that case.
	 */
	static fromConfig(
		config: TelemetryConfig,
		runtime: TelemetryRegistryRuntimeOptions = {},
		env: NodeJS.ProcessEnv = process.env,
	): TelemetryRegistry | undefined {
		if (!resolveEnabled(config, runtime, env)) return undefined;

		// Install diag logger so exporter auth/network errors surface. We set it
		// unconditionally — subsequent registries re-install it, and we clean up
		// on shutdown so tests remain isolated.
		const previousDiagLogger = diag.createComponentLogger({
			namespace: "registry",
		});
		diag.setLogger(createConsoleDiagLogger(), resolveDiagLevel(env));
		const diagCleanup = () => {
			diag.disable();
			// Restore any prior diag logger so parallel tests don't clobber each other
			void previousDiagLogger;
		};

		const resource = resourceFromAttributes(
			buildResourceAttributes(config, runtime, env),
		);

		let processor = runtime.processor;
		if (!processor) {
			const exporter = new OTLPLogExporter({
				url: resolveEndpoint(config, env),
				headers: config.headers,
			});
			processor = runtime.useSimpleProcessor
				? new SimpleLogRecordProcessor(exporter)
				: new BatchLogRecordProcessor(exporter);
		}

		const provider = new LoggerProvider({
			resource,
			processors: [processor],
		});

		const shutdownTimeoutMs = config.shutdownTimeoutMs ?? 3000;
		const shutdownSignalSource = () => AbortSignal.timeout(shutdownTimeoutMs);

		return new TelemetryRegistry(provider, provider, {
			minLogLevel: resolveMinLogLevel(config.minLogLevel),
			shutdownSignalSource,
			diagCleanup,
		});
	}

	/**
	 * Return a sink that forwards records to the OTel provider, with log
	 * records first passing through a level filter. Events always forward
	 * regardless of `minLogLevel` — that filter only applies to `kind="log"`
	 * records.
	 */
	getSink(component: string): LogSink {
		const otelSink = new OtelLogSink(this.providerApi, component);
		return new LevelFilterProcessor(otelSink, this.minLogLevel);
	}

	/**
	 * Fan-out entry point: forwards to the component-neutral "cyrus" OTel
	 * logger. Prefer `getSink(component)` when you have a stable component
	 * name; this method exists so the registry itself is pluggable as a
	 * `LogPipeline` in simple compositions.
	 */
	write(record: Parameters<LogPipeline["write"]>[0]): void {
		const sink = this.getSink(record.component);
		sink.write(record);
	}

	/**
	 * Flush buffered records and tear down the provider.
	 *
	 * Each phase runs under the shared `AbortSignal` (internally derived
	 * from the configured `shutdownTimeoutMs`). If no signal is supplied the
	 * registry uses its own timer so callers never need to plumb one through.
	 */
	async shutdown(signal?: AbortSignal): Promise<void> {
		const effective = signal ?? this.shutdownSignalSource();
		try {
			await raceAbort(
				() => this.provider.forceFlush(),
				effective,
				"provider.forceFlush",
			);
		} finally {
			await raceAbort(
				() => this.provider.shutdown(),
				effective,
				"provider.shutdown",
			);
			if (this.diagCleanup) this.diagCleanup();
		}
	}
}
