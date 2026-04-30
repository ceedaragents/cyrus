import type {
	HookCallbackMatcher,
	HookEvent,
	PostToolUseHookInput,
} from "cyrus-claude-runner";
import type { ILogger } from "cyrus-core";

/**
 * Signature of the Claude Agent SDK bash-wrapper "FD-3 wedge".
 *
 * Reproducer (sandbox-experiments/07-parallel-batch-repro.mjs): when the
 * model emits a parallel `Bash` tool batch and one call errors, the SDK
 * marks the second as `Cancelled`. Every subsequent `Bash` invocation in
 * the same session then fails with exit 126 and the line below in stderr —
 * the eval'd CMD never runs because the outer `bash -c` wrapper aborts on
 * `< /proc/self/fd/3` (or similar) at line 4. We could not capture line 4
 * directly because pure-builtin probes also fail in the wedged state, so
 * the failure is in the SDK-built wrapper itself, not in user code.
 *
 * The matrix in sandbox-experiments/06-permission-mode-matrix.mjs ruled out
 * `permissionMode`, `autoAllowBashIfSandboxed`, `allowDangerouslySkipPermissions`,
 * and narrowing `allowRead` as host-side fixes. Until the upstream SDK bug
 * is fixed, the host can only DETECT the wedge and surface it cleanly.
 *
 * Match shape (case-insensitive on `Permission denied` to be robust to
 * locale/quoting variants of the bash error):
 *   /bin/bash: line 4: /proc/self/fd/3: Permission denied
 */
const WEDGE_SIGNATURE = /\/proc\/self\/fd\/3.{0,40}Permission denied/i;

/**
 * Best-effort extraction of stderr/exit_code from the SDK's
 * `tool_response` for a `Bash` tool call. The SDK types this as `unknown`,
 * so we walk known field shapes defensively rather than assert one.
 */
function extractBashResponse(toolResponse: unknown): {
	stderr: string;
	stdout: string;
	exitCode: number | null;
	combined: string;
} {
	const r = (toolResponse ?? {}) as Record<string, unknown>;
	const pickString = (...keys: string[]): string => {
		for (const k of keys) {
			const v = r[k];
			if (typeof v === "string") return v;
		}
		return "";
	};
	const pickNumber = (...keys: string[]): number | null => {
		for (const k of keys) {
			const v = r[k];
			if (typeof v === "number") return v;
		}
		return null;
	};

	const stderr = pickString("stderr", "error");
	const stdout = pickString("stdout", "output");
	const exitCode = pickNumber("exit_code", "exitCode", "status", "returncode");

	// Fall back to a JSON projection of the whole response for the signature
	// scan — the SDK may shape this object differently across versions, and
	// the signature itself is specific enough that false positives are very
	// unlikely.
	let combined = `${stderr}\n${stdout}`;
	if (combined.trim().length === 0) {
		try {
			combined = JSON.stringify(toolResponse);
		} catch {
			combined = String(toolResponse);
		}
	}

	return { stderr, stdout, exitCode, combined };
}

/**
 * Additional context surfaced to the model on the FIRST detection in a
 * session. Subsequent detections only emit telemetry — the model already has
 * this hint and the underlying tool_result still carries the raw stderr, so
 * piling on extra context per failure would burn tokens without adding
 * information.
 *
 * Phrased as a clear directive: stop using Bash for the rest of the
 * session, and continue the work using Read/Edit/Glob/Grep instead.
 */
const FIRST_HIT_GUIDANCE = [
	"NOTE: A known Claude Agent SDK bug has just made the Bash tool",
	"unrecoverable for the rest of this session. Trigger: a parallel Bash",
	"batch where one call errored. Every subsequent Bash invocation in this",
	"session will fail with exit 126 and",
	"`/bin/bash: line 4: /proc/self/fd/3: Permission denied`.",
	"",
	"Do NOT retry Bash. Continue the task using Read, Edit, Glob, Grep, and",
	"MCP tools where possible. If the remaining work fundamentally requires",
	"Bash (running tests, git push, etc.), stop and explain that you need a",
	"fresh session to finish.",
].join("\n");

/**
 * Build the PostToolUse hook that detects the FD-3 bash wedge.
 *
 * The hook is a no-op when the wedge isn't present. On the first detection
 * within a session, it logs a warning + structured event for telemetry and
 * returns a one-time `additionalContext` to the model. Subsequent detections
 * in the same session emit telemetry only.
 *
 * The set of already-warned session IDs lives in a closure so a single
 * builder instance can dedupe across many tool calls without leaking memory
 * across runner restarts (each new builder gets a fresh Set).
 */
export function buildBashWedgeDetectorHook(
	log: ILogger,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	const warnedSessions = new Set<string>();

	return {
		PostToolUse: [
			{
				matcher: "Bash",
				hooks: [
					async (input) => {
						const post = input as PostToolUseHookInput;
						const { stderr, exitCode, combined } = extractBashResponse(
							post.tool_response,
						);
						if (!WEDGE_SIGNATURE.test(combined)) {
							return {};
						}

						const firstHit = !warnedSessions.has(post.session_id);
						warnedSessions.add(post.session_id);

						log.event("bash_fd3_wedge_detected", {
							sessionId: post.session_id,
							exitCode,
							firstHit,
							// Include a short slice of stderr for diagnostics —
							// bounded so we don't ship arbitrary command output to
							// the structured-log stream.
							stderrPreview: stderr.slice(0, 200) || null,
						});

						if (firstHit) {
							log.warn(
								`[BashWedgeDetector] FD-3 wedge detected in session ${post.session_id}; ` +
									"Bash tool is unrecoverable for the rest of this session. " +
									"This is a Claude Agent SDK bug.",
							);
							return {
								continue: true,
								additionalContext: FIRST_HIT_GUIDANCE,
							};
						}

						return {};
					},
				],
			},
		],
	};
}
