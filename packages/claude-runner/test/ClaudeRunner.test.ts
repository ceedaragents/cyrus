import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock the Claude SDK
vi.mock('@anthropic-ai/claude-code', () => ({
  query: vi.fn(),
  AbortError: class AbortError extends Error {
    name = 'AbortError'
  }
}))

// Mock file system operations
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn()
  }))
}))

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home')
}))

import { query, AbortError } from '@anthropic-ai/claude-code'
import { ClaudeRunner } from '../src/ClaudeRunner'
import type { ClaudeRunnerConfig, SDKMessage } from '../src/types'

describe('ClaudeRunner', () => {
  let runner: ClaudeRunner
  let mockQuery: any
  
  const defaultConfig: ClaudeRunnerConfig = {
    workingDirectory: '/tmp/test'
  }

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()
    
    // Set up mock query function
    mockQuery = vi.mocked(query)
    
    // Create runner instance
    runner = new ClaudeRunner(defaultConfig)
  })

  afterEach(() => {
    // Clean up any running sessions
    if (runner.isRunning()) {
      runner.stop()
    }
  })

  describe('Constructor & Initialization', () => {
    it('should create ClaudeRunner with default config', () => {
      expect(runner).toBeInstanceOf(ClaudeRunner)
      expect(runner).toBeInstanceOf(EventEmitter)
      expect(runner.isRunning()).toBe(false)
    })

    it('should register onMessage callback if provided', () => {
      const onMessage = vi.fn()
      const runnerWithCallback = new ClaudeRunner({
        ...defaultConfig,
        onMessage
      })
      
      runnerWithCallback.emit('message', { type: 'assistant' } as any)
      expect(onMessage).toHaveBeenCalledWith({ type: 'assistant' })
    })

    it('should register onError callback if provided', () => {
      const onError = vi.fn()
      const runnerWithCallback = new ClaudeRunner({
        ...defaultConfig,
        onError
      })
      
      const error = new Error('test error')
      runnerWithCallback.emit('error', error)
      expect(onError).toHaveBeenCalledWith(error)
    })

    it('should register onComplete callback if provided', () => {
      const onComplete = vi.fn()
      const runnerWithCallback = new ClaudeRunner({
        ...defaultConfig,
        onComplete
      })
      
      const messages: SDKMessage[] = []
      runnerWithCallback.emit('complete', messages)
      expect(onComplete).toHaveBeenCalledWith(messages)
    })
  })

  describe('start()', () => {
    it('should start Claude session with basic prompt', async () => {
      // Mock successful query
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      ]
      
      mockQuery.mockImplementation(async function* () {
        for (const message of mockMessages) {
          yield message
        }
      })
      
      const sessionInfo = await runner.start('Hello Claude')
      
      expect(runner.isRunning()).toBe(false) // Should be false after completion
      expect(sessionInfo.sessionId).toBeDefined()
      expect(sessionInfo.startedAt).toBeInstanceOf(Date)
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'Hello Claude',
        options: {
          abortController: expect.any(AbortController),
          cwd: '/tmp/test'
        }
      })
    })

    it('should handle workspace configuration properly', async () => {
      const runnerWithWorkspace = new ClaudeRunner({
        ...defaultConfig,
        workspaceName: 'test-workspace'
      })
      
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      })
      
      await runnerWithWorkspace.start('test')
      
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: {
          abortController: expect.any(AbortController),
          cwd: '/tmp/test'
        }
      })
    })

    it('should use system prompt if provided', async () => {
      const runnerWithSystemPrompt = new ClaudeRunner({
        ...defaultConfig,
        systemPrompt: 'You are a helpful assistant'
      })
      
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      })
      
      await runnerWithSystemPrompt.start('test')
      
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: {
          abortController: expect.any(AbortController),
          cwd: '/tmp/test',
          customSystemPrompt: 'You are a helpful assistant'
        }
      })
    })

    it('should throw error if session already running', async () => {
      // Mock a long-running query
      mockQuery.mockImplementation(async function* () {
        // Simulate a query that never ends
        await new Promise(() => {}) // This will never resolve
      })
      
      // Start first session (don't await, let it hang)
      runner.start('first prompt')
      
      // Wait a bit for the session to start
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Try to start another session
      await expect(runner.start('second prompt')).rejects.toThrow('Claude session already running')
    })

    it('should emit message events for each SDK message', async () => {
      const messageHandler = vi.fn()
      runner.on('message', messageHandler)
      
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any,
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000,
          session_id: 'test-session'
        } as any
      ]
      
      mockQuery.mockImplementation(async function* () {
        for (const message of mockMessages) {
          yield message
        }
      })
      
      await runner.start('test')
      
      expect(messageHandler).toHaveBeenCalledTimes(2)
      expect(messageHandler).toHaveBeenNthCalledWith(1, mockMessages[0])
      expect(messageHandler).toHaveBeenNthCalledWith(2, mockMessages[1])
    })

    it('should emit complete event with all messages', async () => {
      const completeHandler = vi.fn()
      runner.on('complete', completeHandler)
      
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      ]
      
      mockQuery.mockImplementation(async function* () {
        for (const message of mockMessages) {
          yield message
        }
      })
      
      await runner.start('test')
      
      expect(completeHandler).toHaveBeenCalledWith(mockMessages)
    })
  })

  describe('stop()', () => {
    it('should stop running session', async () => {
      let abortController: AbortController | null = null
      
      mockQuery.mockImplementation(async function* ({ options }) {
        abortController = options.abortController
        // Simulate a long-running query
        try {
          await new Promise((resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => reject(new AbortError('Aborted')))
          })
        } catch (error) {
          if (error instanceof AbortError) {
            return // Expected abort
          }
          throw error
        }
      })
      
      // Start session but don't await
      const startPromise = runner.start('test')
      
      // Wait a bit for the session to start
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(runner.isRunning()).toBe(true)
      
      // Stop the session
      runner.stop()
      
      expect(runner.isRunning()).toBe(false)
      expect(abortController?.signal.aborted).toBe(true)
      
      // The start promise should resolve/reject
      await expect(startPromise).resolves.toBeDefined()
    })

    it('should be safe to call stop() when not running', () => {
      expect(() => runner.stop()).not.toThrow()
      expect(runner.isRunning()).toBe(false)
    })
  })

  describe('isRunning()', () => {
    it('should return false initially', () => {
      expect(runner.isRunning()).toBe(false)
    })

    it('should return true during session', async () => {
      let resolveQuery: (value: any) => void
      
      mockQuery.mockImplementation(async function* () {
        return new Promise((resolve) => {
          resolveQuery = resolve
        })
      })
      
      // Start session but don't await
      const startPromise = runner.start('test')
      
      // Wait a bit for the session to start
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(runner.isRunning()).toBe(true)
      
      // Resolve the query
      resolveQuery!()
      await startPromise
      
      expect(runner.isRunning()).toBe(false)
    })
  })

  describe('Message Processing', () => {
    it('should emit text events for assistant text content', async () => {
      const textHandler = vi.fn()
      const assistantHandler = vi.fn()
      
      runner.on('text', textHandler)
      runner.on('assistant', assistantHandler)
      
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          message: { 
            content: [
              { type: 'text', text: 'Hello there!' },
              { type: 'text', text: 'How can I help?' }
            ] 
          },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      ]
      
      mockQuery.mockImplementation(async function* () {
        for (const message of mockMessages) {
          yield message
        }
      })
      
      await runner.start('test')
      
      expect(textHandler).toHaveBeenCalledTimes(2)
      expect(textHandler).toHaveBeenNthCalledWith(1, 'Hello there!')
      expect(textHandler).toHaveBeenNthCalledWith(2, 'How can I help?')
      
      expect(assistantHandler).toHaveBeenCalledTimes(2)
      expect(assistantHandler).toHaveBeenNthCalledWith(1, 'Hello there!')
      expect(assistantHandler).toHaveBeenNthCalledWith(2, 'How can I help?')
    })

    it('should emit tool-use events for tool calls', async () => {
      const toolUseHandler = vi.fn()
      runner.on('tool-use', toolUseHandler)
      
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          message: { 
            content: [
              { 
                type: 'tool_use', 
                name: 'read_file', 
                input: { path: '/test/file.txt' },
                id: 'tool_1'
              }
            ] 
          },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      ]
      
      mockQuery.mockImplementation(async function* () {
        for (const message of mockMessages) {
          yield message
        }
      })
      
      await runner.start('test')
      
      expect(toolUseHandler).toHaveBeenCalledWith('read_file', { path: '/test/file.txt' })
    })
  })

  describe('Error Handling', () => {
    it('should emit error event on query failure', async () => {
      const errorHandler = vi.fn()
      runner.on('error', errorHandler)
      
      const testError = new Error('Query failed')
      mockQuery.mockImplementation(async function* () {
        throw testError
      })
      
      const sessionInfo = await runner.start('test')
      
      expect(errorHandler).toHaveBeenCalledWith(testError)
      expect(runner.isRunning()).toBe(false)
      expect(sessionInfo).toBeDefined()
    })

    it('should handle AbortError gracefully', async () => {
      const errorHandler = vi.fn()
      runner.on('error', errorHandler)
      
      mockQuery.mockImplementation(async function* () {
        throw new AbortError('Session aborted')
      })
      
      await runner.start('test')
      
      expect(errorHandler).not.toHaveBeenCalled()
      expect(runner.isRunning()).toBe(false)
    })

    it('should handle SIGTERM (exit code 143) gracefully', async () => {
      const errorHandler = vi.fn()
      runner.on('error', errorHandler)
      
      mockQuery.mockImplementation(async function* () {
        throw new Error('Claude Code process exited with code 143')
      })
      
      await runner.start('test')
      
      expect(errorHandler).not.toHaveBeenCalled()
      expect(runner.isRunning()).toBe(false)
    })
  })

  describe('Session Info', () => {
    it('should return null session info when not running', () => {
      expect(runner.getSessionInfo()).toBeNull()
    })

    it('should return session info after starting', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      })
      
      const sessionInfo = await runner.start('test')
      
      expect(sessionInfo).toBeDefined()
      expect(sessionInfo.sessionId).toBeDefined()
      expect(sessionInfo.startedAt).toBeInstanceOf(Date)
      expect(sessionInfo.isRunning).toBe(false) // Completed
    })
  })

  describe('Session ID Extraction', () => {
    it('should extract session ID from first Claude message', async () => {
      const messageHandler = vi.fn()
      runner.on('message', messageHandler)
      
      mockQuery.mockImplementation(async function* () {
        // First message without session ID
        yield {
          type: 'start',
          timestamp: '2024-01-01T00:00:00Z'
        } as any
        
        // Second message with session ID
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'extracted-session-123'
        } as any
      })
      
      const sessionInfo = await runner.start('test')
      
      expect(sessionInfo.sessionId).toBe('extracted-session-123')
      expect(messageHandler).toHaveBeenCalledTimes(2)
    })

    it('should update streaming prompt when session ID is extracted', async () => {
      let capturedPrompt: any = null
      
      mockQuery.mockImplementation(async function* (options: any) {
        capturedPrompt = options.prompt
        
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'new-session-456'
        } as any
      })
      
      await runner.start('test')
      
      // Verify the streaming prompt was created and would be updated
      expect(capturedPrompt).toBeDefined()
    })

    it('should handle messages without session ID gracefully', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'No session ID here!' }] },
          parent_tool_use_id: null
          // No session_id field
        } as any
      })
      
      const sessionInfo = await runner.start('test')
      
      expect(sessionInfo.sessionId).toBeNull()
    })

    it('should only extract session ID once from first message that has it', async () => {
      const logSpy = vi.spyOn(console, 'log')
      
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'First' }] },
          session_id: 'first-session-id'
        } as any
        
        yield {
          type: 'assistant', 
          message: { content: [{ type: 'text', text: 'Second' }] },
          session_id: 'second-session-id' // Should be ignored
        } as any
      })
      
      const sessionInfo = await runner.start('test')
      
      expect(sessionInfo.sessionId).toBe('first-session-id')
      expect(logSpy).toHaveBeenCalledWith('[ClaudeRunner] Session ID assigned by Claude: first-session-id')
      expect(logSpy).not.toHaveBeenCalledWith('[ClaudeRunner] Session ID assigned by Claude: second-session-id')
    })
  })

  describe('Message History', () => {
    it('should return empty messages initially', () => {
      expect(runner.getMessages()).toEqual([])
    })

    it('should collect all messages during session', async () => {
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any,
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000,
          session_id: 'test-session'
        } as any
      ]
      
      mockQuery.mockImplementation(async function* () {
        for (const message of mockMessages) {
          yield message
        }
      })
      
      await runner.start('test')
      
      const messages = runner.getMessages()
      expect(messages).toEqual(mockMessages)
    })

    it('should return copy of messages array', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
          parent_tool_use_id: null,
          session_id: 'test-session'
        } as any
      })
      
      await runner.start('test')
      
      const messages1 = runner.getMessages()
      const messages2 = runner.getMessages()
      
      expect(messages1).toEqual(messages2)
      expect(messages1).not.toBe(messages2) // Different array instances
    })
  })
})