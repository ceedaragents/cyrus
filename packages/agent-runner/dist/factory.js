import { ClaudeRunnerAdapter } from "./adapters/ClaudeRunnerAdapter.js";
import { CodexRunnerAdapter } from "./adapters/CodexRunnerAdapter.js";
import { OpenCodeRunnerAdapter } from "./adapters/OpenCodeRunnerAdapter.js";
export class DefaultRunnerFactory {
	create(config) {
		switch (config.type) {
			case "claude":
				return new ClaudeRunnerAdapter(config);
			case "codex":
				return new CodexRunnerAdapter(config);
			case "opencode":
				return new OpenCodeRunnerAdapter(config);
			default:
				throw new Error(`Unsupported runner type: ${config.type}`);
		}
	}
}
export const defaultRunnerFactory = new DefaultRunnerFactory();
export function createRunner(config) {
	return defaultRunnerFactory.create(config);
}
//# sourceMappingURL=factory.js.map
