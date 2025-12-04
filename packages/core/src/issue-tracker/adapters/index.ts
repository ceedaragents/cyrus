/**
 * Issue tracker adapters
 *
 * Platform-specific implementations of IIssueTrackerService and related components
 *
 * @module issue-tracker/adapters
 */

export { CLIEventTransport } from "./CLIEventTransport.js";
export type { CLIIssueTrackerState } from "./CLIIssueTrackerService.js";
export { CLIIssueTrackerService } from "./CLIIssueTrackerService.js";
export type {
	AgentActivityData,
	AgentSessionData,
	AssignIssueData,
	// Assign Issue
	AssignIssueParams,
	CLIRPCServerConfig,
	CreateCommentData,
	// Create Comment
	CreateCommentParams,
	CreateIssueData,
	// Create Issue
	CreateIssueParams,
	ListAgentSessionsData,
	// List Agent Sessions
	ListAgentSessionsParams,
	PingData,
	// Ping
	PingParams,
	PromptSessionData,
	// Prompt Session
	PromptSessionParams,
	RPCCommand,
	RPCRequest,
	RPCResponse,
	StartSessionData,
	// Start Session
	StartSessionParams,
	StatusData,
	// Status
	StatusParams,
	StopSessionData,
	// Stop Session
	StopSessionParams,
	VersionData,
	// Version
	VersionParams,
	ViewSessionData,
	// View Session
	ViewSessionParams,
} from "./CLIRPCServer.js";
export { CLIRPCServer } from "./CLIRPCServer.js";
export type { CLIAgentActivityData } from "./CLITypes.js";
