import * as os from "node:os";
import * as v8 from "node:v8";

/**
 * Memory gate configuration. When any threshold is set and exceeded,
 * the gate reports unhealthy. All thresholds are optional — omitting
 * them all produces a no-op gate that always reports healthy.
 */
export interface MemoryGateConfig {
	/**
	 * Enable the memory gate. When false or omitted, `checkMemoryHealth`
	 * always returns ok=true.
	 * @default false
	 */
	enabled?: boolean;

	/**
	 * Reject new work when the current process RSS exceeds this fraction
	 * of total system memory. Range: 0..1.
	 * Example: 0.75 means "reject if process is using more than 75% of
	 * total system memory". Useful on dedicated hosts where Cyrus is the
	 * dominant workload.
	 */
	maxRssPercent?: number;

	/**
	 * Reject new work when available system memory (os.freemem) is below
	 * this number of megabytes. Guards against OOM-kill by systemd-oomd
	 * or the kernel OOM killer when the host is under pressure.
	 */
	minAvailableMemoryMb?: number;

	/**
	 * Reject new work when V8 heap used exceeds this fraction of the
	 * heap size limit. Range: 0..1. Guards against "JavaScript heap out
	 * of memory" fatal aborts.
	 */
	maxHeapUsagePercent?: number;
}

/**
 * Cross-platform memory snapshot captured at check time.
 * All byte values are normalized to megabytes (MB = 1024 * 1024 bytes).
 */
export interface MemoryMetrics {
	/** Resident set size of the Cyrus process, in MB. */
	rssMb: number;
	/** Total system memory reported by os.totalmem(), in MB. */
	totalSystemMemoryMb: number;
	/** Available system memory reported by os.freemem(), in MB. */
	availableSystemMemoryMb: number;
	/** V8 heap bytes currently used, in MB. */
	heapUsedMb: number;
	/** V8 heap size limit (hard cap before heap OOM), in MB. */
	heapLimitMb: number;
	/** RSS as a fraction of total system memory (0..1). */
	rssPercent: number;
	/** Heap used as a fraction of heap size limit (0..1). */
	heapPercent: number;
}

export type MemoryCheckResult =
	| { ok: true; metrics: MemoryMetrics }
	| { ok: false; reason: string; metrics: MemoryMetrics };

const BYTES_PER_MB = 1024 * 1024;

function toMb(bytes: number): number {
	return bytes / BYTES_PER_MB;
}

/**
 * Injectable data sources for testability. In production, the default
 * implementations call the cross-platform Node built-ins.
 */
export interface MemorySources {
	rssBytes: () => number;
	totalSystemBytes: () => number;
	availableSystemBytes: () => number;
	heapUsedBytes: () => number;
	heapLimitBytes: () => number;
}

const defaultSources: MemorySources = {
	rssBytes: () => process.memoryUsage().rss,
	totalSystemBytes: () => os.totalmem(),
	availableSystemBytes: () => os.freemem(),
	heapUsedBytes: () => v8.getHeapStatistics().used_heap_size,
	heapLimitBytes: () => v8.getHeapStatistics().heap_size_limit,
};

export function collectMemoryMetrics(
	sources: MemorySources = defaultSources,
): MemoryMetrics {
	const rssBytes = sources.rssBytes();
	const totalBytes = sources.totalSystemBytes();
	const freeBytes = sources.availableSystemBytes();
	const heapUsed = sources.heapUsedBytes();
	const heapLimit = sources.heapLimitBytes();

	const rssPercent = totalBytes > 0 ? rssBytes / totalBytes : 0;
	const heapPercent = heapLimit > 0 ? heapUsed / heapLimit : 0;

	return {
		rssMb: toMb(rssBytes),
		totalSystemMemoryMb: toMb(totalBytes),
		availableSystemMemoryMb: toMb(freeBytes),
		heapUsedMb: toMb(heapUsed),
		heapLimitMb: toMb(heapLimit),
		rssPercent,
		heapPercent,
	};
}

/**
 * Evaluate the memory gate against current process + system metrics.
 *
 * Uses only cross-platform Node built-ins (os.totalmem, os.freemem,
 * process.memoryUsage, v8.getHeapStatistics), so it behaves the same
 * on Linux and macOS.
 */
export function checkMemoryHealth(
	config: MemoryGateConfig | undefined,
	sources: MemorySources = defaultSources,
): MemoryCheckResult {
	const metrics = collectMemoryMetrics(sources);

	if (!config?.enabled) {
		return { ok: true, metrics };
	}

	const { maxRssPercent, minAvailableMemoryMb, maxHeapUsagePercent } = config;

	if (typeof maxRssPercent === "number" && metrics.rssPercent > maxRssPercent) {
		return {
			ok: false,
			reason: `Process RSS at ${(metrics.rssPercent * 100).toFixed(1)}% of system memory (limit ${(maxRssPercent * 100).toFixed(1)}%, ${metrics.rssMb.toFixed(0)}MB of ${metrics.totalSystemMemoryMb.toFixed(0)}MB)`,
			metrics,
		};
	}

	if (
		typeof minAvailableMemoryMb === "number" &&
		metrics.availableSystemMemoryMb < minAvailableMemoryMb
	) {
		return {
			ok: false,
			reason: `Available system memory ${metrics.availableSystemMemoryMb.toFixed(0)}MB below minimum ${minAvailableMemoryMb}MB`,
			metrics,
		};
	}

	if (
		typeof maxHeapUsagePercent === "number" &&
		metrics.heapPercent > maxHeapUsagePercent
	) {
		return {
			ok: false,
			reason: `V8 heap at ${(metrics.heapPercent * 100).toFixed(1)}% of limit (threshold ${(maxHeapUsagePercent * 100).toFixed(1)}%, ${metrics.heapUsedMb.toFixed(0)}MB of ${metrics.heapLimitMb.toFixed(0)}MB)`,
			metrics,
		};
	}

	return { ok: true, metrics };
}

/**
 * Format a user-facing rejection message explaining that the host is
 * temporarily out of capacity. Suitable for posting to Linear/GitHub/
 * GitLab/Slack when the memory gate trips.
 */
export function formatMemoryPressureMessage(reason: string): string {
	return `Cyrus is temporarily out of capacity and can't start this session right now. Please retry shortly.\n\n_Reason: ${reason}_`;
}
