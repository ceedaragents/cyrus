/**
 * Shared webhook header parsing utilities for event transports.
 */

export type HeaderValue = string | string[] | undefined;
export type IncomingHeaders = Record<string, HeaderValue> | undefined;

/**
 * Supported webhook providers for typed header parsing.
 */
export type WebhookProvider = "github" | "slack" | "linear" | "chat-sdk";

/**
 * Canonical header keys used by the provider-aware header parser.
 */
type WebhookHeaderAlias =
	| "authorization"
	| "type"
	| "eventType"
	| "envelopeType"
	| "deliveryId"
	| "envelopeEventId"
	| "signature"
	| "teamId"
	| "installationToken"
	| "slackBotToken"
	| "linearApiToken";

/**
 * A map of canonical header keys to accepted raw header names.
 */
export type WebhookHeaderAliasMap = Partial<
	Record<WebhookHeaderAlias, readonly string[]>
>;

/**
 * Parsed webhook header values after provider normalization.
 */
export interface ParsedWebhookHeaders {
	/**
	 * Authorization header value.
	 */
	authorization?: string;
	/**
	 * Parsed Bearer token from authorization header, if present.
	 */
	authorizationToken?: string;
	/**
	 * Event type from provider-specific metadata headers.
	 */
	eventType?: string;
	/**
	 * Canonicalized event type across provider-specific and proxied headers.
	 */
	type?: string;
	/**
	 * Envelope event type for platforms that use envelope semantics.
	 */
	envelopeType?: string;
	/**
	 * Platform delivery/request id.
	 */
	deliveryId?: string;
	/**
	 * Platform envelope event id.
	 */
	envelopeEventId?: string;
	/**
	 * Signature header value for webhook verification.
	 */
	signature?: string;
	/**
	 * Team/workspace id from platform event metadata.
	 */
	teamId?: string;
	/**
	 * Installation token (GitHub App forwarding).
	 */
	installationToken?: string;
	/**
	 * Slack bot token from proxy headers (when forwarding webhooks).
	 */
	slackBotToken?: string;
	/**
	 * Linear API token from proxy headers (when forwarding webhooks).
	 */
	linearApiToken?: string;
}

/**
 * Common contract for parser instances.
 */
export interface IWebhookProviderHeaders {
	/**
	 * Provider name for the parser.
	 */
	provider: WebhookProvider;
	/**
	 * Read the current provider and parsed values.
	 */
	parse(): ParsedWebhookHeaders;
}

/**
 * Normalized view of a webhook request's headers.
 */
export class WebhookHeaders {
	private headers: IncomingHeaders;

	constructor(headers: IncomingHeaders) {
		this.headers = headers;
	}

	/**
	 * Read a header value by name using case-insensitive lookup.
	 */
	protected readHeader(...names: string[]): string | undefined {
		if (!this.headers) {
			return undefined;
		}

		for (const name of names) {
			const rawValue = this.findHeaderValue(name);
			if (rawValue) {
				return rawValue;
			}
		}

		return undefined;
	}

	/**
	 * Find a single header value.
	 */
	private findHeaderValue(name: string): string | undefined {
		if (!this.headers) {
			return undefined;
		}

		const exact = this.headers[name];
		if (exact) {
			return this.toString(exact);
		}

		const lower = name.toLowerCase();
		const lowerValue = this.headers[lower];
		if (lowerValue) {
			return this.toString(lowerValue);
		}

		const upperValue = this.headers[lower.toUpperCase()];
		if (upperValue) {
			return this.toString(upperValue);
		}

		const canonical = this.toHeaderCase(name);
		const canonicalValue = this.headers[canonical];
		if (canonicalValue) {
			return this.toString(canonicalValue);
		}

		return undefined;
	}

	/**
	 * Convert `string | string[]` header values to a normalized string.
	 */
	private toString(value: HeaderValue): string | undefined {
		if (typeof value === "string") {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === "string") {
					const trimmed = item.trim();
					if (trimmed.length > 0) {
						return trimmed;
					}
				}
			}
		}

		return undefined;
	}

	/**
	 * Transform `x-foo-bar` into `X-Foo-Bar` for best-effort lookup.
	 */
	private toHeaderCase(value: string): string {
		return value
			.split("-")
			.map((part) =>
				part.length > 0
					? `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}`
					: part,
			)
			.join("-");
	}
}

/**
 * Base class for webhook headers that use Bearer authorization.
 */
export class BearerWebhookHeaders extends WebhookHeaders {
	/**
	 * Extract a Bearer token from common auth header variants.
	 */
	protected getBearerToken(...names: string[]): string | undefined {
		const token = this.readHeader(...names);
		if (!token) {
			return undefined;
		}

		if (!token.startsWith("Bearer ")) {
			return undefined;
		}

		const extracted = token.slice("Bearer ".length).trim();
		return extracted.length > 0 ? extracted : undefined;
	}
}

/**
 * Shared provider parser abstraction.
 */
export abstract class ProviderWebhookHeaders
	extends BearerWebhookHeaders
	implements IWebhookProviderHeaders
{
	/**
	 * Provider-specific raw header aliases.
	 */
	protected readonly aliases: WebhookHeaderAliasMap;

	constructor(headers: IncomingHeaders, aliases: WebhookHeaderAliasMap) {
		super(headers);
		this.aliases = aliases;
	}

	/**
	 * Provider name for this parser.
	 */
	abstract provider: WebhookProvider;

	/**
	 * Parse the currently supported headers for this provider.
	 */
	parse(): ParsedWebhookHeaders {
		return {
			authorization: this.getAuthorization(),
			type: this.getType(),
			authorizationToken: this.getAuthorizationToken(),
			eventType: this.getEventType(),
			envelopeType: this.getEnvelopeType(),
			deliveryId: this.getDeliveryId(),
			envelopeEventId: this.getEnvelopeEventId(),
			signature: this.getSignature(),
			teamId: this.getTeamId(),
			installationToken: this.getInstallationToken(),
			slackBotToken: this.getSlackBotToken(),
			linearApiToken: this.getLinearApiToken(),
		};
	}

	/**
	 * Read the first header in the alias list for a key.
	 */
	protected getAliasValue(alias: WebhookHeaderAlias): string | undefined {
		const options = this.aliases[alias];
		if (!options || options.length === 0) {
			return undefined;
		}

		return this.readHeader(...options);
	}

	/**
	 * Read a Bearer token using the authorization alias list.
	 */
	protected getAliasBearerToken(): string | undefined {
		const options = this.aliases.authorization;
		if (!options || options.length === 0) {
			return undefined;
		}

		return this.getBearerToken(...options);
	}

	getAuthorization(): string | undefined {
		return this.getAliasValue("authorization");
	}

	getAuthorizationToken(): string | undefined {
		return this.getAliasBearerToken();
	}

	getType(): string | undefined {
		return (
			this.getAliasValue("type") ??
			this.getAliasValue("eventType") ??
			this.getAliasValue("envelopeType")
		);
	}

	getEventType(): string | undefined {
		return this.getAliasValue("eventType");
	}

	getEnvelopeType(): string | undefined {
		return this.getAliasValue("envelopeType");
	}

	getDeliveryId(): string | undefined {
		return this.getAliasValue("deliveryId");
	}

	getEnvelopeEventId(): string | undefined {
		return this.getAliasValue("envelopeEventId");
	}

	getSignature(): string | undefined {
		return this.getAliasValue("signature");
	}

	getTeamId(): string | undefined {
		return this.getAliasValue("teamId");
	}

	getInstallationToken(): string | undefined {
		return this.getAliasValue("installationToken");
	}

	getSlackBotToken(): string | undefined {
		return this.getAliasValue("slackBotToken");
	}

	getLinearApiToken(): string | undefined {
		return this.getAliasValue("linearApiToken");
	}
}

/**
 * Shared interface for webhook event type headers.
 */
export interface WebhookEventHeaderValues {
	/**
	 * Normalized event type for routing.
	 */
	eventType?: string;
	/**
	 * Event identifier when provided by transport.
	 */
	eventId?: string;
	/**
	 * Delivery/request correlation identifier.
	 */
	deliveryId?: string;
}

/**
 * GitHub-specific webhook headers.
 */
export class GitHubWebhookHeaders extends ProviderWebhookHeaders {
	private static aliases: WebhookHeaderAliasMap = {
		authorization: ["authorization"],
		type: [
			"x-github-event",
			"x-github-event-type",
			"x-cyhost-github-event",
			"x-cyrus-github-event",
			"x-event-type",
		],
		eventType: [
			"x-github-event",
			"x-github-event-type",
			"x-cyhost-github-event",
			"x-cyrus-github-event",
			"x-event-type",
		],
		deliveryId: [
			"x-github-delivery",
			"x-delivery-id",
			"x-cyhost-delivery-id",
			"x-cyrus-delivery-id",
		],
		installationToken: [
			"x-github-installation-token",
			"x-cyhost-github-installation-token",
			"x-cyrus-installation-token",
		],
		signature: [
			"x-hub-signature-256",
			"x-github-signature-256",
			"x-cyhost-github-signature",
		],
	};

	provider: WebhookProvider = "github";

	constructor(headers: IncomingHeaders) {
		super(headers, GitHubWebhookHeaders.aliases);
	}

	getEventType(): string | undefined {
		return super.getEventType();
	}

	getDeliveryId(): string | undefined {
		return super.getDeliveryId();
	}

	getInstallationToken(): string | undefined {
		return super.getInstallationToken();
	}

	getSignature256(): string | undefined {
		return this.getSignature();
	}
}

/**
 * Slack-specific webhook headers.
 */
export class SlackWebhookHeaders extends ProviderWebhookHeaders {
	private static aliases: WebhookHeaderAliasMap = {
		authorization: ["authorization"],
		type: [
			"x-slack-event-type",
			"x-cyhost-slack-event-type",
			"x-cyrus-slack-event-type",
			"x-event-type",
		],
		envelopeType: [
			"x-slack-event-type",
			"x-cyhost-slack-event-type",
			"x-cyrus-slack-event-type",
			"x-event-type",
		],
		envelopeEventId: [
			"x-slack-event-id",
			"x-cyhost-slack-event-id",
			"x-cyrus-slack-event-id",
			"x-event-id",
		],
		teamId: [
			"x-slack-team-id",
			"x-cyhost-slack-team-id",
			"x-cyrus-slack-team-id",
		],
		slackBotToken: [
			"x-slack-bot-token",
			"x-cyhost-slack-bot-token",
			"x-cyrus-slack-bot-token",
			"x-bot-token",
			"slack-bot-token",
		],
	};

	provider: WebhookProvider = "slack";

	constructor(headers: IncomingHeaders) {
		super(headers, SlackWebhookHeaders.aliases);
	}

	getEnvelopeType(): string | undefined {
		return super.getEnvelopeType();
	}

	getEnvelopeEventId(): string | undefined {
		return super.getEnvelopeEventId();
	}

	getTeamId(): string | undefined {
		return super.getTeamId();
	}
}

/**
 * Linear-specific webhook headers.
 */
export class LinearWebhookHeaders extends ProviderWebhookHeaders {
	private static aliases: WebhookHeaderAliasMap = {
		authorization: ["authorization"],
		type: [
			"x-event-type",
			"linear-event-type",
			"x-linear-event-type",
			"x-cyhost-linear-event-type",
			"x-cyrus-linear-event-type",
		],
		eventType: [
			"x-event-type",
			"linear-event-type",
			"x-linear-event-type",
			"x-cyhost-linear-event-type",
			"x-cyrus-linear-event-type",
		],
		signature: [
			"linear-signature",
			"x-linear-signature",
			"x-cyhost-linear-signature",
			"x-cyrus-linear-signature",
		],
		linearApiToken: [
			"linear-token",
			"x-linear-token",
			"x-linear-api-token",
			"x-cyhost-linear-token",
			"x-cyrus-linear-token",
		],
	};

	provider: WebhookProvider = "linear";

	constructor(headers: IncomingHeaders) {
		super(headers, LinearWebhookHeaders.aliases);
	}

	getSignature(): string | undefined {
		return super.getSignature();
	}
}

/**
 * Chat SDK specific webhook headers.
 */
export class ChatSDKWebhookHeaders extends ProviderWebhookHeaders {
	private static aliases: WebhookHeaderAliasMap = {
		authorization: [
			"authorization",
			"x-chat-sdk-authorization",
			"x-chat-authorization",
		],
		type: ["x-chat-sdk-event-type", "x-chat-event-type", "x-event-type"],
		eventType: ["x-chat-sdk-event-type", "x-chat-event-type", "x-event-type"],
		envelopeType: ["x-chat-sdk-envelope-type", "x-chat-envelope-type"],
		deliveryId: [
			"x-chat-sdk-delivery-id",
			"x-chat-delivery-id",
			"x-delivery-id",
		],
		envelopeEventId: ["x-chat-sdk-event-id", "x-chat-event-id", "x-event-id"],
		signature: ["x-chat-sdk-signature", "x-chat-signature"],
		teamId: ["x-chat-sdk-team-id", "x-chat-team-id"],
	};

	provider: WebhookProvider = "chat-sdk";

	constructor(headers: IncomingHeaders) {
		super(headers, ChatSDKWebhookHeaders.aliases);
	}
}

/**
 * Event routing headers commonly available in proxied webhook setups.
 */
export interface ProxiedWebhookHeaders extends WebhookEventHeaderValues {
	/**
	 * Normalized event type value for generic proxy payloads.
	 */
	type?: string;
	source?: string;
}
