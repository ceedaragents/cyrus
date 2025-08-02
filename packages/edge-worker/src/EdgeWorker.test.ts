import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EdgeWorker } from './EdgeWorker.js'
import type { EdgeWorkerConfig } from './types.js'

// Mock fs/promises before the module is imported
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('test')),
  rename: vi.fn().mockResolvedValue(undefined)
}))

// Mock file-type
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue({ ext: 'png', mime: 'image/png' })
}))

describe('EdgeWorker Attachment Handling', () => {
  let edgeWorker: EdgeWorker
  let mockLinearClient: any
  let mockConfig: EdgeWorkerConfig

  beforeEach(() => {
    // Mock Linear client
    mockLinearClient = {
      issue: vi.fn(),
      comments: vi.fn()
    }

    // Basic config
    mockConfig = {
      repositories: [{
        id: 'test-repo',
        name: 'Test Repository',
        linearToken: 'test-token',
        linearAgentUserId: 'agent-123',
        workspaceBaseDir: '/tmp/test',
        allowedTools: ['All_Tools'],
        isActive: true
      }],
      webhookPort: 3456
    }

    // Create EdgeWorker instance
    edgeWorker = new EdgeWorker(mockConfig)
    ;(edgeWorker as any).linearClients.set('test-repo', mockLinearClient)
  })

  describe('fetchFullIssueDetails', () => {
    it('should fetch attachments from Linear API', async () => {
      // Mock issue with attachments
      const mockAttachments = {
        nodes: [
          {
            id: 'att-1',
            title: 'Screenshot',
            url: 'https://uploads.linear.app/12345/screenshot.png',
            source: null
          },
          {
            id: 'att-2',
            title: 'Error: Rendered more hooks than during the previous render',
            url: 'https://sentry.io/organizations/example/issues/123456/',
            source: 'Sentry'
          }
        ]
      }

      const mockIssue = {
        id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        description: 'Test description',
        attachments: vi.fn().mockResolvedValue(mockAttachments),
        parent: null
      }

      mockLinearClient.issue.mockResolvedValue(mockIssue)

      // Call fetchFullIssueDetails
      const result = await (edgeWorker as any).fetchFullIssueDetails('issue-123', 'test-repo')

      // Verify attachments were fetched
      expect(mockIssue.attachments).toHaveBeenCalled()
      expect(result._attachments).toEqual(mockAttachments.nodes)
      expect(result._attachments).toHaveLength(2)
    })

    it('should handle errors when fetching attachments gracefully', async () => {
      const mockIssue = {
        id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        attachments: vi.fn().mockRejectedValue(new Error('API Error')),
        parent: null
      }

      mockLinearClient.issue.mockResolvedValue(mockIssue)

      // Should not throw error
      const result = await (edgeWorker as any).fetchFullIssueDetails('issue-123', 'test-repo')
      
      expect(result).toBeTruthy()
      expect(result._attachments).toBeUndefined()
    })
  })

  describe('downloadIssueAttachments', () => {
    it('should differentiate between Linear uploads and external links', async () => {
      const mockIssue = {
        id: 'issue-123',
        identifier: 'TEST-123',
        description: 'Issue with attachments',
        _attachments: [
          {
            id: 'att-1',
            title: 'Screenshot',
            url: 'https://uploads.linear.app/12345/screenshot.png',
            source: null
          },
          {
            id: 'att-2',
            title: 'Sentry Error',
            subtitle: 'ValueError: Could not find the pattern',
            url: 'https://sentry.io/organizations/example/issues/123456/',
            source: 'Sentry'
          },
          {
            id: 'att-3',
            title: 'GitHub PR',
            url: 'https://github.com/example/repo/pull/42',
            source: 'GitHub'
          }
        ]
      }

      // Mock file download functions
      const mockFetch = vi.fn()
      global.fetch = mockFetch
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
      })

      // File system operations are already mocked at the top of the file

      // Call downloadIssueAttachments
      const result = await (edgeWorker as any).downloadIssueAttachments(
        mockIssue as any,
        mockConfig.repositories[0], // Pass repository config
        '/tmp/test/workspace' // Pass workspace path, not attachments path
      )

      // Verify results
      expect(result).toBeDefined()
      expect(result.manifest).toBeDefined()
      expect(result.attachmentsDir).toMatch(/\.cyrus.*workspace.*attachments$/) // Should have downloaded one file
      
      // Parse the manifest to verify content
      const manifest = result.manifest
      
      // Check summary line
      expect(manifest).toContain('Downloaded 1 file (including 1 image), Found 2 external links')
      
      // Check external links section
      expect(manifest).toContain('### External Links')
      expect(manifest).toContain('1. **Sentry Error**')
      expect(manifest).toContain('- URL: https://sentry.io/organizations/example/issues/123456/')
      expect(manifest).toContain('- Source: Sentry')
      
      expect(manifest).toContain('2. **GitHub PR**')
      expect(manifest).toContain('- URL: https://github.com/example/repo/pull/42')
      expect(manifest).toContain('- Source: GitHub')
      
      // Check images section
      expect(manifest).toContain('### Images')
      expect(manifest).toContain('image_1.png')
      expect(manifest).toContain('https://uploads.linear.app/12345/screenshot.png')
      
      // Verify that only Linear upload was actually downloaded
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://uploads.linear.app/12345/screenshot.png',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' }
        })
      )
    })
  })

  describe('generateAttachmentManifest', () => {
    it('should generate manifest with external links section', () => {
      const downloadResult = {
        attachmentMap: {},
        imageMap: {
          'https://uploads.linear.app/123/image.png': '/tmp/test/attachments/image_1.png'
        },
        externalLinkMap: {
          'https://sentry.io/issues/123/': {
            title: 'Error: Rendered more hooks',
            url: 'https://sentry.io/issues/123/',
            source: 'Sentry'
          },
          'https://example.com/docs': {
            title: 'API Documentation',
            url: 'https://example.com/docs',
            source: undefined
          }
        },
        totalFound: 3,
        downloaded: 1,
        imagesDownloaded: 1,
        externalLinksFound: 2,
        skipped: 0,
        failed: 0
      }

      const manifest = (edgeWorker as any).generateAttachmentManifest(downloadResult)

      // Verify manifest structure
      expect(manifest).toContain('## Attachments & External Links')
      expect(manifest).toContain('Downloaded 1 file (including 1 image), Found 2 external links.')
      
      // Verify external links section comes first
      expect(manifest).toContain('### External Links')
      expect(manifest).toContain('1. **Error: Rendered more hooks**')
      expect(manifest).toContain('- URL: https://sentry.io/issues/123/')
      expect(manifest).toContain('- Source: Sentry')
      
      expect(manifest).toContain('2. **API Documentation**')
      expect(manifest).toContain('- URL: https://example.com/docs')
      expect(manifest).not.toContain('- Source: undefined') // Should not show undefined source
      
      expect(manifest).toContain('These external links provide additional context')
      expect(manifest).toContain('WebFetch tool')
      
      // Verify images section
      expect(manifest).toContain('### Images')
      expect(manifest).toContain('image_1.png')
    })

    it('should handle case with only external links', () => {
      const downloadResult = {
        attachmentMap: {},
        imageMap: {},
        externalLinkMap: {
          'https://sentry.io/issues/123/': {
            title: 'Sentry Error',
            url: 'https://sentry.io/issues/123/',
            source: 'Sentry'
          }
        },
        totalFound: 1,
        downloaded: 0,
        imagesDownloaded: 0,
        externalLinksFound: 1,
        skipped: 0,
        failed: 0
      }

      const manifest = (edgeWorker as any).generateAttachmentManifest(downloadResult)

      expect(manifest).toContain('Found 1 external link.')
      expect(manifest).toContain('### External Links')
      expect(manifest).not.toContain('### Images')
      expect(manifest).not.toContain('### Other Attachments')
    })
  })
})