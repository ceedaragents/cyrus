#!/usr/bin/env node

import { LinearClient } from '@linear/sdk'
import dotenv from 'dotenv'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

async function testSentryAttachments() {
  const linearToken = process.env.LINEAR_API_TOKEN
  if (!linearToken) {
    console.error('Please set LINEAR_API_TOKEN in packages/edge-worker/.env')
    process.exit(1)
  }

  const linearClient = new LinearClient({
    accessToken: linearToken
  })

  try {
    console.log('Testing Linear issue attachments with Sentry links...\n')

    // Test GraphQL query to find issues with Sentry attachments
    console.log('1. Searching for issues with Sentry attachments...')
    const issues = await linearClient.issues({
      filter: {
        attachments: {
          some: {
            url: { contains: "sentry" }
          }
        }
      },
      first: 5
    })

    console.log(`Found ${issues.nodes.length} issues with Sentry attachments\n`)

    // Test fetching attachments for each issue
    for (const issue of issues.nodes) {
      console.log(`\n2. Testing issue: ${issue.identifier} - ${issue.title}`)
      console.log(`   URL: ${issue.url}`)
      
      // Fetch attachments
      const attachments = await issue.attachments()
      console.log(`   Found ${attachments.nodes.length} attachments:`)
      
      // Display attachment details
      for (const attachment of attachments.nodes) {
        console.log(`\n   Attachment:`)
        console.log(`   - ID: ${attachment.id}`)
        console.log(`   - Title: ${attachment.title || 'No title'}`)
        console.log(`   - Subtitle: ${attachment.subtitle || 'No subtitle'}`)
        console.log(`   - URL: ${attachment.url}`)
        console.log(`   - Source: ${attachment.source || 'No source'}`)
        console.log(`   - Is External: ${!attachment.url.includes('uploads.linear.app')}`)
        
        if (attachment.url.includes('sentry')) {
          console.log(`   ✅ This is a Sentry link!`)
        }
      }
    }

    // Test with a specific issue if provided
    const testIssueId = process.argv[2]
    if (testIssueId) {
      console.log(`\n3. Testing specific issue: ${testIssueId}`)
      const issue = await linearClient.issue(testIssueId)
      if (issue) {
        console.log(`   Title: ${issue.title}`)
        const attachments = await issue.attachments()
        console.log(`   Attachments: ${attachments.nodes.length}`)
        for (const attachment of attachments.nodes) {
          console.log(`   - ${attachment.title}: ${attachment.url}`)
        }
      }
    }

    console.log('\n✅ Test completed successfully!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run the test
testSentryAttachments()