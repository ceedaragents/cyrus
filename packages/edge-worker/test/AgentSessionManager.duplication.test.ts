import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LinearClient, LinearDocument } from '@linear/sdk'
import { AgentSessionManager } from '../src/AgentSessionManager'
import type { SDKAssistantMessage, SDKResultMessage, APIAssistantMessage } from 'cyrus-claude-runner'

// Mock LinearClient
vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createAgentActivity: vi.fn()
  })),
  LinearDocument: {
    AgentSessionType: {
      CommentThread: 'comment_thread'
    },
    AgentSessionStatus: {
      Active: 'active',
      Complete: 'complete',
      Error: 'error'
    }
  }
}))

describe('AgentSessionManager - Last Message Duplication', () => {
  let manager: AgentSessionManager
  let mockLinearClient: any
  let createAgentActivitySpy: any
  const sessionId = 'test-session-123'
  const issueId = 'issue-123'

  beforeEach(() => {
    mockLinearClient = new LinearClient({ apiKey: 'test' })
    createAgentActivitySpy = vi.spyOn(mockLinearClient, 'createAgentActivity')
    createAgentActivitySpy.mockResolvedValue({ 
      success: true, 
      agentActivity: Promise.resolve({ id: 'activity-123' }) 
    })
    
    manager = new AgentSessionManager(mockLinearClient)
    
    // Create a test session
    manager.createLinearAgentSession(sessionId, issueId, {
      id: issueId,
      identifier: 'TEST-123',
      title: 'Test Issue',
      url: 'https://linear.app/test/issue/TEST-123'
    }, {
      id: 'workspace-123',
      name: 'Test Workspace',
      displayName: 'Test Workspace'
    })
  })

  it('should duplicate the last assistant message as both thought and response without the fix', async () => {
    const claudeSessionId = 'claude-session-123'
    
    // Simulate system message to set Claude session ID
    await manager.handleClaudeMessage(sessionId, {
      type: 'system',
      subtype: 'init',
      session_id: claudeSessionId,
      model: 'test-model',
      tools: [],
      permissionMode: 'test',
      apiKeySource: 'test'
    })

    // Simulate assistant message with "Summary for Linear:"
    const summaryContent = `Summary for Linear:
- What bug/error was identified: Last message duplication
- Root cause analysis: Messages posted as both thought and response
- Fix implemented: None yet
- Tests added/passing: Creating test now`

    const assistantMessage: SDKAssistantMessage = {
      type: 'assistant',
      session_id: claudeSessionId,
      parent_tool_use_id: null,
      message: {
        content: summaryContent,
        role: 'assistant'
      } as APIAssistantMessage
    }

    await manager.handleClaudeMessage(sessionId, assistantMessage)

    // Simulate result message with same content
    const resultMessage: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      result: summaryContent,
      session_id: claudeSessionId,
      duration_ms: 1000,
      duration_api_ms: 800,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 150
      }
    }

    await manager.handleClaudeMessage(sessionId, resultMessage)

    // Verify the duplication issue exists
    expect(createAgentActivitySpy).toHaveBeenCalledTimes(2)

    // First call should be for the assistant message (thought)
    const firstCall = createAgentActivitySpy.mock.calls[0][0]
    expect(firstCall.content.type).toBe('thought')
    expect(firstCall.content.body).toBe(summaryContent)

    // Second call should be for the result message (response)
    const secondCall = createAgentActivitySpy.mock.calls[1][0]
    expect(secondCall.content.type).toBe('response')
    expect(secondCall.content.body).toBe(summaryContent)

    // This demonstrates the bug: same content posted twice with different types
    console.log('BUG REPRODUCED: Last message posted as both thought and response')
  })

  it('should NOT duplicate the last message when using the special marker', async () => {
    const claudeSessionId = 'claude-session-123'
    
    // Simulate system message to set Claude session ID
    await manager.handleClaudeMessage(sessionId, {
      type: 'system',
      subtype: 'init',
      session_id: claudeSessionId,
      model: 'test-model',
      tools: [],
      permissionMode: 'test',
      apiKeySource: 'test'
    })

    // Simulate assistant message with marker and "Summary for Linear:"
    const summaryContent = `___LAST_MESSAGE_MARKER___Summary for Linear:
- What bug/error was identified: Last message duplication
- Root cause analysis: Messages posted as both thought and response
- Fix implemented: Using special marker to prevent duplication
- Tests added/passing: This test verifies the fix`

    const assistantMessage: SDKAssistantMessage = {
      type: 'assistant',
      session_id: claudeSessionId,
      parent_tool_use_id: null,
      message: {
        content: summaryContent,
        role: 'assistant'
      } as APIAssistantMessage
    }

    await manager.handleClaudeMessage(sessionId, assistantMessage)

    // Simulate result message with same content (including marker)
    const resultMessage: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      result: summaryContent,
      session_id: claudeSessionId,
      duration_ms: 1000,
      duration_api_ms: 800,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 150
      }
    }

    await manager.handleClaudeMessage(sessionId, resultMessage)

    // Verify the fix works: only one activity created (the response)
    expect(createAgentActivitySpy).toHaveBeenCalledTimes(1)

    // The single call should be for the result message (response) with marker stripped
    const call = createAgentActivitySpy.mock.calls[0][0]
    expect(call.content.type).toBe('response')
    expect(call.content.body).not.toContain('___LAST_MESSAGE_MARKER___')
    expect(call.content.body).toContain('Summary for Linear:')
    
    console.log('FIX VERIFIED: Marker prevents duplication and is stripped from output')
  })
})