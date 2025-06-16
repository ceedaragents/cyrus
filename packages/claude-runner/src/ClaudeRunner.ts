import { EventEmitter } from 'events'
import { mkdirSync, createWriteStream, type WriteStream, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { query, type SDKMessage, AbortError } from '@anthropic-ai/claude-code'
import type { ClaudeRunnerConfig, ClaudeRunnerEvents, ClaudeSessionInfo } from './types.js'

export declare interface ClaudeRunner {
  on<K extends keyof ClaudeRunnerEvents>(event: K, listener: ClaudeRunnerEvents[K]): this
  emit<K extends keyof ClaudeRunnerEvents>(event: K, ...args: Parameters<ClaudeRunnerEvents[K]>): boolean
}

/**
 * Manages Claude SDK sessions and communication
 */
export class ClaudeRunner extends EventEmitter {
  private config: ClaudeRunnerConfig
  private abortController: AbortController | null = null
  private sessionInfo: ClaudeSessionInfo | null = null
  private logStream: WriteStream | null = null
  private messages: SDKMessage[] = []

  constructor(config: ClaudeRunnerConfig) {
    super()
    this.config = config

    // Forward config callbacks to events
    if (config.onMessage) this.on('message', config.onMessage)
    if (config.onError) this.on('error', config.onError)
    if (config.onComplete) this.on('complete', config.onComplete)
  }

  /**
   * Start a new Claude session
   */
  async start(prompt: string): Promise<ClaudeSessionInfo> {
    if (this.isRunning()) {
      throw new Error('Claude session already running')
    }

    // Generate session ID and create session info
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.sessionInfo = {
      sessionId,
      startedAt: new Date(),
      isRunning: true
    }

    console.log(`[ClaudeRunner] Starting new session: ${sessionId}`)
    console.log('[ClaudeRunner] Working directory:', this.config.workingDirectory)

    // Ensure working directory exists
    if (this.config.workingDirectory) {
      try {
        mkdirSync(this.config.workingDirectory, { recursive: true })
        console.log('[ClaudeRunner] Created working directory')
      } catch (err) {
        console.error('[ClaudeRunner] Failed to create working directory:', err)
      }
    }

    // Set up logging
    this.setupLogging()

    // Create abort controller for this session
    this.abortController = new AbortController()

    // Reset messages array
    this.messages = []

    try {
      // Start the query
      console.log(`[ClaudeRunner] Starting query with prompt length: ${prompt.length} characters`)
      
      // Process allowed directories by adding Read patterns to allowedTools
      let processedAllowedTools = this.config.allowedTools ? [...this.config.allowedTools] : undefined
      if (this.config.allowedDirectories && this.config.allowedDirectories.length > 0) {
        const directoryTools = this.config.allowedDirectories.map(dir => {
          // Add extra / prefix for absolute paths to ensure Claude Code recognizes them properly
          // See: https://docs.anthropic.com/en/docs/claude-code/settings#read-%26-edit
          const prefixedPath = dir.startsWith('/') ? `/${dir}` : dir
          return `Read(${prefixedPath}/**)`
        })
        processedAllowedTools = processedAllowedTools ? [...processedAllowedTools, ...directoryTools] : directoryTools
      }

      // Parse MCP config if provided
      let mcpServers = {}
      if (this.config.mcpConfigPath) {
        try {
          const mcpConfigContent = readFileSync(this.config.mcpConfigPath, 'utf8')
          const mcpConfig = JSON.parse(mcpConfigContent)
          mcpServers = mcpConfig.mcpServers || {}
          console.log(`[ClaudeRunner] Loaded MCP servers: ${Object.keys(mcpServers).join(', ')}`)
        } catch (error) {
          console.error(`[ClaudeRunner] Failed to load MCP config from ${this.config.mcpConfigPath}:`, error)
        }
      }

      const queryOptions: Parameters<typeof query>[0] = {
        prompt,
        abortController: this.abortController,
        options: {
          ...(this.config.workingDirectory && { cwd: this.config.workingDirectory }),
          ...(this.config.systemPrompt && { systemPrompt: this.config.systemPrompt }),
          ...(processedAllowedTools && { allowedTools: processedAllowedTools }),
          ...(this.config.continueSession && { continue: this.config.continueSession }),
          ...(Object.keys(mcpServers).length > 0 && { mcpServers })
        }
      }

      // Process messages from the query
      for await (const message of query(queryOptions)) {
        if (!this.sessionInfo?.isRunning) {
          console.log('[ClaudeRunner] Session was stopped, breaking from query loop')
          break
        }

        this.messages.push(message)
        console.log(`[ClaudeRunner] Received message: ${message.type}`)
        
        // Log the message
        if (this.logStream) {
          const logEntry = {
            type: 'sdk-message',
            message,
            timestamp: new Date().toISOString()
          }
          this.logStream.write(JSON.stringify(logEntry) + '\n')
        }

        // Emit appropriate events based on message type
        this.emit('message', message)
        this.processMessage(message)
      }

      // Session completed successfully
      console.log(`[ClaudeRunner] Session completed with ${this.messages.length} messages`)
      this.sessionInfo.isRunning = false
      this.emit('complete', this.messages)

    } catch (error) {
      console.error('[ClaudeRunner] Session error:', error)
      
      if (this.sessionInfo) {
        this.sessionInfo.isRunning = false
      }

      if (error instanceof AbortError) {
        console.log('[ClaudeRunner] Session was aborted')
      } else if (error instanceof Error && error.message.includes('Claude Code process exited with code 143')) {
        // Exit code 143 is SIGTERM (128 + 15), which indicates graceful termination
        // This is expected when the session is stopped during unassignment
        console.log('[ClaudeRunner] Session was terminated gracefully (SIGTERM)')
      } else {
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      // Clean up
      this.abortController = null
      
      // Close log stream
      if (this.logStream) {
        this.logStream.end()
        this.logStream = null
      }
    }

    return this.sessionInfo
  }

  /**
   * Stop the current Claude session
   */
  stop(): void {
    if (this.abortController) {
      console.log('[ClaudeRunner] Stopping Claude session')
      this.abortController.abort()
      this.abortController = null
    }
    
    if (this.sessionInfo) {
      this.sessionInfo.isRunning = false
    }
  }

  /**
   * Check if session is running
   */
  isRunning(): boolean {
    return this.sessionInfo?.isRunning ?? false
  }

  /**
   * Get current session info
   */
  getSessionInfo(): ClaudeSessionInfo | null {
    return this.sessionInfo
  }

  /**
   * Get all messages from current session
   */
  getMessages(): SDKMessage[] {
    return [...this.messages]
  }

  /**
   * Process individual SDK messages and emit appropriate events
   */
  private processMessage(message: SDKMessage): void {
    switch (message.type) {
      case 'assistant':
        if (message.message?.content && Array.isArray(message.message.content)) {
          // Process content blocks
          for (const block of message.message.content) {
            if (block.type === 'text') {
              this.emit('text', block.text)
              this.emit('assistant', block.text)
            } else if (block.type === 'tool_use') {
              this.emit('tool-use', block.name, block.input)
            }
          }
        }
        break
        
      case 'user':
        // User messages don't typically need special processing
        break
        
      case 'result':
        // Result messages indicate completion
        break
        
      case 'system':
        // System messages are for initialization
        break
        
      default:
        console.log(`[ClaudeRunner] Unhandled message type: ${(message as any).type}`)
    }
  }

  /**
   * Set up logging to .cyrus directory
   */
  private setupLogging(): void {
    try {
      // Create logs directory structure: ~/.cyrus/logs/<workspace-name>/
      const cyrusDir = join(homedir(), '.cyrus')
      const logsDir = join(cyrusDir, 'logs')
      
      // Get workspace name from config or extract from working directory
      const workspaceName = this.config.workspaceName || 
        (this.config.workingDirectory ? this.config.workingDirectory.split('/').pop() : 'default') || 
        'default'
      const workspaceLogsDir = join(logsDir, workspaceName)
      
      // Create directories
      mkdirSync(workspaceLogsDir, { recursive: true })
      
      // Create log file with session ID and timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const logFileName = `session-${this.sessionInfo?.sessionId || 'unknown'}-${timestamp}.jsonl`
      const logFilePath = join(workspaceLogsDir, logFileName)
      
      console.log(`[ClaudeRunner] Creating log file at: ${logFilePath}`)
      this.logStream = createWriteStream(logFilePath, { flags: 'a' })
      
      // Write initial metadata
      const metadata = {
        type: 'session-metadata',
        sessionId: this.sessionInfo?.sessionId,
        startedAt: this.sessionInfo?.startedAt?.toISOString(),
        workingDirectory: this.config.workingDirectory,
        workspaceName: workspaceName,
        timestamp: new Date().toISOString()
      }
      this.logStream.write(JSON.stringify(metadata) + '\n')
      
    } catch (error) {
      console.error('[ClaudeRunner] Failed to set up logging:', error)
    }
  }
}