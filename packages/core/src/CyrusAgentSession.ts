/**
 * Agent Session types for Linear Agent Sessions integration
 * These types represent the core data structures for tracking Claude Code sessions in Linear
 */

import { LinearDocument } from "@linear/sdk"
import { ClaudeRunner } from "cyrus-claude-runner"

export interface IssueMinimal {
  id: string
  identifier: string
  title: string
  description?: string
  branchName: string
}

export interface Workspace {
  path: string
  isGitWorktree: boolean
  historyPath?: string
}

export interface CyrusAgentSession {
  linearAgentActivitySessionId: string
  type: LinearDocument.AgentSessionType.CommentThread
  status: LinearDocument.AgentSessionStatus
  context: LinearDocument.AgentSessionType.CommentThread
  createdAt: number // e.g. Date.now()
  updatedAt: number // e.g. Date.now()
  issueId: string
  issue: IssueMinimal
  workspace: Workspace
  claudeSessionId?: string // this gets assigned once it initializes
  claudeRunner?: ClaudeRunner
  metadata?: {
    model?: string
    tools?: string[]
    permissionMode?: string
    apiKeySource?: string
    totalCostUsd?: number
    usage?: any
    commentId?: string
  }
}

export interface CyrusAgentSessionEntry {
  claudeSessionId: string // originated in this claude sessions
  linearAgentActivityId?: string // got assigned this ID in linear, after creation, for this 'agent activity'
  type: 'user' | 'assistant' | 'system' | 'result'
  content: string
  metadata?: {
    toolUseId?: string
    toolName?: string
    toolInput?: any
    parentToolUseId?: string
    timestamp: number // e.g. Date.now()
    durationMs?: number
    isError?: boolean
  }
}