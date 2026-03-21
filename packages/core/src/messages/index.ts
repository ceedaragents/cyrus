/**
 * Internal Message Bus
 *
 * This module exports all types and utilities for the internal message bus
 * that provides a unified interface for handling events from multiple
 * webhook sources (Linear, GitHub, Slack, etc.).
 *
 * @module messages
 */

// Translator interface
export type {
	IMessageTranslator,
	TranslationContext,
	TranslationResult,
} from "./IMessageTranslator.js";

// Platform reference types
export type {
	DiscordPlatformRef,
	GitHubPlatformRef,
	LinearPlatformRef,
	SlackPlatformRef,
} from "./platform-refs.js";

// Type guards
export {
	hasDiscordSessionStartPlatformData,
	hasDiscordUserPromptPlatformData,
	hasGitHubSessionStartPlatformData,
	hasGitHubUserPromptPlatformData,
	hasLinearSessionStartPlatformData,
	hasLinearUserPromptPlatformData,
	hasSlackSessionStartPlatformData,
	hasSlackUserPromptPlatformData,
	isContentUpdateMessage,
	isDiscordMessage,
	isGitHubMessage,
	isIssueStateChangeMessage,
	isLinearMessage,
	isSessionStartMessage,
	isSlackMessage,
	isStopSignalMessage,
	isUnassignMessage,
	isUserPromptMessage,
} from "./type-guards.js";
// Core message types
export type {
	ContentChanges,
	ContentUpdateMessage,
	// Discord platform data types
	DiscordSessionStartPlatformData,
	DiscordUserPromptPlatformData,
	GitHubSessionStartPlatformData,
	GitHubUserPromptPlatformData,
	GuidanceItem,
	InternalMessage,
	InternalMessageBase,
	IssueStateChangeMessage,
	LinearContentUpdatePlatformData,
	LinearIssueStateChangePlatformData,
	// Platform-specific data types
	LinearSessionStartPlatformData,
	LinearStopSignalPlatformData,
	LinearUnassignPlatformData,
	LinearUserPromptPlatformData,
	MessageAction,
	MessageAuthor,
	MessageSource,
	SessionStartMessage,
	// Slack platform data types
	SlackSessionStartPlatformData,
	SlackUserPromptPlatformData,
	StopSignalMessage,
	UnassignMessage,
	UserPromptMessage,
} from "./types.js";
