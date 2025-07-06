#!/usr/bin/env node

/**
 * Debug streaming to match exact production flow
 */

import { ClaudeRunner } from '../dist/index.js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })

async function main() {
  console.log('🔍 Debug Streaming Test - Matching Production Flow')
  
  // EXACT production config from EdgeWorker
  const config = {
    workingDirectory: '/Users/agentops/code/ceedar-new-workspaces/CEE-739',
    allowedTools: [
      "Read", "Edit", "MultiEdit", "Write", 
      "Bash", "Glob", "Grep", "LS", 
      "Task", "WebFetch", "WebSearch",
      "TodoRead", "TodoWrite",
      "NotebookRead", "NotebookEdit"
    ],
    continueSession: true,  // EdgeWorker sets this!
    workspaceName: 'CEE-739',
    mcpConfigPath: ['/Users/agentops/code/ceedarmcpconfig.json'],
    mcpConfig: {
      "linear": {
        "type": "stdio", 
        "command": "npx",
        "args": ["-y", "@tacticlaunch/mcp-linear"],
        "env": {
          "LINEAR_API_TOKEN": process.env.LINEAR_API_TOKEN
        }
      }
    },
    onMessage: (message) => {
      console.log(`📧 Message: ${message.type}`)
    },
    onError: (error) => {
      console.error('❌ Error:', error)
    },
    onComplete: (messages) => {
      console.log(`✅ Completed with ${messages.length} messages`)
    }
  }
  
  const runner = new ClaudeRunner(config)
  
  try {
    // Test with a simple prompt first
    console.log('🔄 Starting streaming with simple prompt...')
    const sessionInfo = await runner.startStreaming('Hello, what tools do you have?')
    
    console.log(`📊 Session started: ${sessionInfo.sessionId}`)
    console.log(`🌊 Is streaming: ${runner.isStreaming()}`)
    
    // Wait to see if it completes or hangs
    let completed = false
    runner.on('complete', () => {
      completed = true
      console.log('✅ Session completed!')
    })
    
    // Give it 30 seconds
    await new Promise((resolve) => {
      setTimeout(() => {
        if (!completed) {
          console.log('❌ Session hung after 30 seconds')
        }
        resolve()
      }, 30000)
    })
    
  } catch (error) {
    console.error('💥 Error:', error)
  }
}

main().catch(console.error)