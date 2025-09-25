import { ClaudeRunnerAdapter } from "./adapters/ClaudeRunnerAdapter.js";
import { CodexRunnerAdapter } from "./adapters/CodexRunnerAdapter.js";
import { OpenCodeRunnerAdapter } from "./adapters/OpenCodeRunnerAdapter.js";
import type { Runner, RunnerConfig, RunnerFactory } from "./types.js";

export class DefaultRunnerFactory implements RunnerFactory {
	create(config: RunnerConfig): Runner {
		switch (config.type) {
			case "claude":
				return new ClaudeRunnerAdapter(config);
			case "codex":
				return new CodexRunnerAdapter(config);
			case "opencode":
				return new OpenCodeRunnerAdapter(config);
			default:
				throw new Error(
					`Unsupported runner type: ${(config as RunnerConfig).type}`,
				);
		}
	}
}

export const defaultRunnerFactory = new DefaultRunnerFactory();

export function createRunner(config: RunnerConfig): Runner {
	return defaultRunnerFactory.create(config);
}
