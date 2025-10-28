import type { MockedClass } from "vitest-mock-extended";
import type { SharedApplicationServer } from "../src/SharedApplicationServer.js";

/**
 * Create a mock SharedApplicationServer for testing
 */
export function createMockSharedApplicationServer(): MockedClass<SharedApplicationServer> {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		registerHandler: vi.fn(),
		registerHandlers: vi.fn(),
		registerWebhookHandler: vi.fn(),
		unregisterWebhookHandler: vi.fn(),
		getPort: vi.fn().mockReturnValue(3456),
		getBaseUrl: vi.fn().mockReturnValue("http://localhost:3456"),
		getPublicUrl: vi.fn().mockReturnValue("http://localhost:3456"),
		getWebhookUrl: vi.fn().mockReturnValue("http://localhost:3456/webhook"),
		getOAuthCallbackUrl: vi
			.fn()
			.mockReturnValue("http://localhost:3456/callback"),
	} as any;
}
