import type { Runner, RunnerConfig, RunnerFactory } from "./types.js";
export declare class DefaultRunnerFactory implements RunnerFactory {
	create(config: RunnerConfig): Runner;
}
export declare const defaultRunnerFactory: DefaultRunnerFactory;
export declare function createRunner(config: RunnerConfig): Runner;
//# sourceMappingURL=factory.d.ts.map
