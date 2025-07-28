#!/usr/bin/env node

/**
 * Integration test for the dual logging system (detailed + readable logs)
 * 
 * This test:
 * 1. Creates a ClaudeRunner session with both log types enabled
 * 2. Runs a simple conversation to generate different message types
 * 3. Verifies both detailed (.jsonl) and readable (.md) logs are created
 * 4. Validates that readable log filters out system noise
 * 5. Checks that detailed log contains all raw data
 */

import { ClaudeRunner } from '../dist/ClaudeRunner.js'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, readdirSync } from 'fs'
import { tmpdir, homedir } from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function testReadableLogging() {
  console.log('🧪 Dual Logging System Integration Test')
  console.log('=======================================\n')

  // Uses Claude Code system authentication
  console.log('💡 Using Claude Code SDK authentication')

  // Create test workspace
  const testWorkspaceDir = resolve(tmpdir(), `dual-logging-test-${Date.now()}`)
  const logsWorkspaceName = `dual-logging-test-${Date.now()}`
  
  try {
    console.log('🔧 Setting up test environment...')
    
    // Create test directory structure
    mkdirSync(testWorkspaceDir, { recursive: true })
    
    // Create a test file for Claude to read
    writeFileSync(resolve(testWorkspaceDir, 'test-data.txt'), 'This is test data for the logging integration test.')
    
    console.log('✅ Test environment created')
    console.log(`📂 Workspace: ${testWorkspaceDir}`)

    // Set up ClaudeRunner with logging enabled
    console.log('\n🚀 Starting Claude session with dual logging...')
    const runner = new ClaudeRunner({
      workingDirectory: testWorkspaceDir,
      workspaceName: logsWorkspaceName,
      allowedTools: ['Read', 'Write'],
      onMessage: (message) => {
        console.log(`📨 [${message.type}] Message received`)
      }
    })

    const testPrompt = `Hello! Please help me test the logging system by:

1. Reading the test-data.txt file in this directory
2. Writing a brief summary of what you found
3. Telling me what tools you have available

This will generate different types of messages for our logging test.`

    const sessionInfo = await runner.start(testPrompt)
    
    console.log('\n✅ Session completed!')
    console.log(`Session ID: ${sessionInfo.sessionId}`)

    // Wait for logs to be written
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Check log files
    const logsDir = join(homedir(), '.cyrus', 'logs', logsWorkspaceName)
    console.log(`\n📝 Checking logs in: ${logsDir}`)

    if (!existsSync(logsDir)) {
      throw new Error(`Logs directory not found: ${logsDir}`)
    }

    const logFiles = readdirSync(logsDir)
    const jsonlFile = logFiles.find(f => f.endsWith('.jsonl'))
    const mdFile = logFiles.find(f => f.endsWith('.md'))

    console.log(`📊 Detailed log: ${jsonlFile || 'NOT FOUND'}`)
    console.log(`📖 Readable log: ${mdFile || 'NOT FOUND'}`)

    // Validate both files exist
    if (!jsonlFile) {
      throw new Error('Detailed log (.jsonl) file not found')
    }
    if (!mdFile) {
      throw new Error('Readable log (.md) file not found')
    }

    // Read and validate detailed log
    const detailedLogPath = join(logsDir, jsonlFile)
    const detailedLogContent = readFileSync(detailedLogPath, 'utf8')
    const detailedLogLines = detailedLogContent.trim().split('\n')
    
    console.log(`\n📊 Detailed log analysis:`)
    console.log(`- File size: ${detailedLogContent.length} bytes`)
    console.log(`- Line count: ${detailedLogLines.length}`)
    
    // Check for expected content in detailed log
    const hasSystemMessage = detailedLogContent.includes('"type":"system"')
    const hasAssistantMessage = detailedLogContent.includes('"type":"assistant"')
    const hasToolUse = detailedLogContent.includes('"type":"tool_use"')
    
    console.log(`- Contains system messages: ${hasSystemMessage ? '✅' : '❌'}`)
    console.log(`- Contains assistant messages: ${hasAssistantMessage ? '✅' : '❌'}`)
    console.log(`- Contains tool usage: ${hasToolUse ? '✅' : '❌'}`)

    // Read and validate readable log
    const readableLogPath = join(logsDir, mdFile)
    const readableLogContent = readFileSync(readableLogPath, 'utf8')
    
    console.log(`\n📖 Readable log analysis:`)
    console.log(`- File size: ${readableLogContent.length} bytes`)
    
    // Check readable log format and content
    const hasMarkdownHeader = readableLogContent.includes('# Claude Session Log')
    const hasSessionInfo = readableLogContent.includes('**Session ID:**')
    const hasClaudeResponse = readableLogContent.includes('## ') && readableLogContent.includes('- Claude Response')
    const hasSessionComplete = readableLogContent.includes('## ') && readableLogContent.includes('- Session Complete')
    
    // Should NOT contain system noise or TodoWrite calls
    const hasSystemNoise = readableLogContent.includes('"type":"system"') || 
                          readableLogContent.includes('tool_use_id') ||
                          readableLogContent.includes('parent_tool_use_id')
    const hasTodoWriteNoise = readableLogContent.includes('Tool: TodoWrite')
    
    console.log(`- Has markdown header: ${hasMarkdownHeader ? '✅' : '❌'}`)
    console.log(`- Has session info: ${hasSessionInfo ? '✅' : '❌'}`)
    console.log(`- Has Claude responses: ${hasClaudeResponse ? '✅' : '❌'}`)
    console.log(`- Has session completion: ${hasSessionComplete ? '✅' : '❌'}`)
    console.log(`- Free of system noise: ${!hasSystemNoise ? '✅' : '❌'}`)
    console.log(`- Free of TodoWrite noise: ${!hasTodoWriteNoise ? '✅' : '❌'}`)

    // Sample readable log content
    console.log(`\n📖 Sample readable log content:`)
    console.log('=' .repeat(60))
    const lines = readableLogContent.split('\n')
    const sampleLines = lines.slice(0, Math.min(15, lines.length))
    console.log(sampleLines.join('\n'))
    if (lines.length > 15) {
      console.log(`... (${lines.length - 15} more lines)`)
    }
    console.log('=' .repeat(60))

    // Overall validation
    const allTestsPassed = jsonlFile && mdFile && 
                          hasSystemMessage && hasAssistantMessage &&
                          hasMarkdownHeader && hasSessionInfo && 
                          hasClaudeResponse && !hasSystemNoise && !hasTodoWriteNoise

    console.log(`\n🎯 Overall Result:`)
    if (allTestsPassed) {
      console.log('✅ SUCCESS: Dual logging system working correctly!')
      console.log('   - Both detailed and readable logs created')
      console.log('   - Detailed log contains all raw data')
      console.log('   - Readable log filters system noise')
      console.log('   - Readable log uses clean markdown format')
    } else {
      console.log('❌ FAILURE: Some logging tests failed')
      if (!jsonlFile) console.log('   - Missing detailed log file')
      if (!mdFile) console.log('   - Missing readable log file')
      if (!hasSystemMessage || !hasAssistantMessage) console.log('   - Detailed log missing expected content')
      if (!hasMarkdownHeader || !hasSessionInfo) console.log('   - Readable log missing proper format')
      if (hasSystemNoise) console.log('   - Readable log contains system noise')
      if (hasTodoWriteNoise) console.log('   - Readable log contains TodoWrite noise')
    }

    return allTestsPassed

  } catch (error) {
    console.error('\n💥 Test failed with error:', error)
    return false
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test environment...')
    if (existsSync(testWorkspaceDir)) {
      rmSync(testWorkspaceDir, { recursive: true, force: true })
    }
    
    // Clean up logs directory
    const logsDir = join(homedir(), '.cyrus', 'logs', logsWorkspaceName)
    if (existsSync(logsDir)) {
      rmSync(logsDir, { recursive: true, force: true })
    }
    
    console.log('✅ Cleanup complete')
    
    // Force exit
    setTimeout(() => {
      process.exit(allTestsPassed ? 0 : 1)
    }, 1000)
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testReadableLogging()
    .then(success => {
      process.exit(success ? 0 : 1)
    })
    .catch(error => {
      console.error('Test execution failed:', error)
      process.exit(1)
    })
}

export { testReadableLogging }