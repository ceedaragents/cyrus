/**
 * @cyrus/abstractions
 *
 * Core abstractions and interfaces for the Cyrus I/O system
 *
 * This package defines platform-agnostic interfaces for:
 * - Agent runners (Claude, OpenAI, etc.)
 * - Input sources (webhooks, HTTP, CLI, etc.)
 * - Output renderers (Linear, CLI, Slack, etc.)
 * - Orchestration (connecting inputs, processing, and outputs)
 *
 * These interfaces allow for:
 * 1. Pluggable implementations
 * 2. Easy testing with mocks
 * 3. Language-agnostic integration
 * 4. Clear separation of concerns
 *
 * Example usage:
 * ```typescript
 * import { IAgentRunner, IOutputRenderer, IOrchestrator } from '@cyrus/abstractions';
 *
 * // Implement the interfaces
 * class MyAgentRunner implements IAgentRunner { ... }
 * class MyRenderer implements IOutputRenderer { ... }
 *
 * // Use them together
 * const orchestrator: IOrchestrator = ...;
 * orchestrator.addOutputRenderer('my-renderer', new MyRenderer());
 * await orchestrator.start();
 * ```
 */

// Agent abstractions
export * from "./agent/index.js";

// Input abstractions
export * from "./input/index.js";
// Orchestration abstractions
export * from "./orchestration/index.js";
// Output abstractions
export * from "./output/index.js";
