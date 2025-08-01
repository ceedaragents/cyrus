import { describe, it, expect, beforeEach } from 'vitest'
import { EdgeWorker } from '../src/EdgeWorker.js'
import type { LinearWebhook, LinearAgentSessionCreatedWebhook, LinearAgentSessionPromptedWebhook } from 'cyrus-core'
import type { EdgeWorkerConfig } from '../src/types.js'

describe('EdgeWorker - Repository Routing', () => {
  let edgeWorker: EdgeWorker
  let mockConfig: EdgeWorkerConfig

  beforeEach(() => {
    // Mock configuration with multiple repositories
    mockConfig = {
      proxyUrl: 'https://test-proxy.com',
      repositories: [
        {
          id: 'ceedar',
          name: 'Ceedar',
          repositoryPath: '/repos/ceedar',
          baseBranch: 'main',
          workspaceBaseDir: '/tmp/workspaces',
          linearToken: 'linear-token-1',
          linearWorkspaceId: 'workspace-1',
          linearWorkspaceName: 'Ceedar Agents',
          teamKeys: ['CEE'],
          isActive: true
        },
        {
          id: 'bookkeeping',
          name: 'Bookkeeping',
          repositoryPath: '/repos/bookkeeping',
          baseBranch: 'main',
          workspaceBaseDir: '/tmp/workspaces',
          linearToken: 'linear-token-2',
          linearWorkspaceId: 'workspace-2',
          linearWorkspaceName: 'Bookkeeping Team',
          teamKeys: ['BK'],
          isActive: true
        }
      ]
    }

    edgeWorker = new EdgeWorker(mockConfig)
  })

  describe('AgentSession webhook routing', () => {
    it('should route AgentSessionCreated webhook to correct repository based on team key', async () => {
      const ceeWebhook: LinearAgentSessionCreatedWebhook = {
        type: 'AgentSession',
        action: 'create',
        organizationId: 'workspace-1',
        agentSession: {
          id: 'session-123',
          issue: {
            id: 'issue-123',
            identifier: 'CEE-42',
            title: 'Test Issue',
            team: {
              key: 'CEE'
            }
          }
        }
      }

      // Call the public method directly to test routing logic
      const result = await edgeWorker.findRepositoryForWebhook(ceeWebhook, mockConfig.repositories)

      // Verify the correct repository was returned
      expect(result).toBeTruthy()
      expect(result?.id).toBe('ceedar')
    })

    it('should route AgentSessionPrompted webhook to correct repository based on team key', async () => {
      const bkWebhook: LinearAgentSessionPromptedWebhook = {
        type: 'AgentSession',
        action: 'prompt',
        organizationId: 'workspace-2',
        agentSession: {
          id: 'session-456',
          issue: {
            id: 'issue-456',
            identifier: 'BK-123',
            title: 'Bookkeeping Issue',
            team: {
              key: 'BK'
            }
          }
        },
        agentActivity: {
          content: {
            body: 'Please help with this issue'
          }
        }
      }

      // Call the public method directly to test routing logic
      const result = await edgeWorker.findRepositoryForWebhook(bkWebhook, mockConfig.repositories)

      // Verify the correct repository was returned
      expect(result).toBeTruthy()
      expect(result?.id).toBe('bookkeeping')
    })

    it('should fallback to issue identifier parsing when team key is not available', async () => {
      const webhookWithoutTeamKey: LinearAgentSessionCreatedWebhook = {
        type: 'AgentSession',
        action: 'create',
        organizationId: 'workspace-1',
        agentSession: {
          id: 'session-789',
          issue: {
            id: 'issue-789',
            identifier: 'CEE-999',
            title: 'Test Issue Without Team'
            // Note: no team key provided
          }
        }
      }

      // Call the public method directly to test routing logic
      const result = await edgeWorker.findRepositoryForWebhook(webhookWithoutTeamKey, mockConfig.repositories)

      // Verify the correct repository was returned based on identifier parsing
      expect(result).toBeTruthy()
      expect(result?.id).toBe('ceedar')
    })

    it('should return null when no matching repository is found', async () => {
      const unmatchedWebhook: LinearAgentSessionCreatedWebhook = {
        type: 'AgentSession',
        action: 'create',
        organizationId: 'workspace-unknown',
        agentSession: {
          id: 'session-unknown',
          issue: {
            id: 'issue-unknown',
            identifier: 'UNKNOWN-123',
            title: 'Unknown Issue',
            team: {
              key: 'UNKNOWN'
            }
          }
        }
      }

      // Call the public method directly to test routing logic
      const result = await edgeWorker.findRepositoryForWebhook(unmatchedWebhook, mockConfig.repositories)

      // Should return null for unmatched webhooks
      expect(result).toBeNull()
    })
  })

  describe('Traditional webhook routing', () => {
    it('should route traditional webhooks based on team key', async () => {
      const traditionalWebhook: LinearWebhook = {
        type: 'AppUserNotification',
        action: 'issueAssignedToYou',
        organizationId: 'workspace-1',
        notification: {
          issue: {
            id: 'issue-traditional',
            identifier: 'CEE-888',
            title: 'Traditional Issue',
            team: {
              id: 'team-1',
              key: 'CEE',
              name: 'Ceedar Team'
            }
          }
        }
      }

      // Call the public method directly to test routing logic
      const result = await edgeWorker.findRepositoryForWebhook(traditionalWebhook, mockConfig.repositories)

      // Verify the correct repository was returned
      expect(result).toBeTruthy()
      expect(result?.id).toBe('ceedar')
    })

    it('should fallback to workspace matching when no team keys match', async () => {
      const configWithCatchAll = {
        ...mockConfig,
        repositories: [
          ...mockConfig.repositories,
          {
            id: 'catch-all',
            name: 'Catch All',
            repositoryPath: '/repos/catch-all',
            baseBranch: 'main',
            workspaceBaseDir: '/tmp/workspaces',
            linearToken: 'linear-token-3',
            linearWorkspaceId: 'workspace-1',
            linearWorkspaceName: 'Catch All Workspace',
            // No teamKeys defined
            isActive: true
          }
        ]
      }

      const webhookWithoutMatchingTeam: LinearWebhook = {
        type: 'AppUserNotification',
        action: 'issueAssignedToYou',
        organizationId: 'workspace-1',
        notification: {
          issue: {
            id: 'issue-nomatch',
            identifier: 'NOMATCH-123',
            title: 'No Matching Team',
            team: {
              id: 'team-nomatch',
              key: 'NOMATCH',
              name: 'No Match Team'
            }
          }
        }
      }

      // Call the public method directly to test routing logic
      const result = await edgeWorker.findRepositoryForWebhook(webhookWithoutMatchingTeam, configWithCatchAll.repositories)

      // Should route to catch-all repository that has no teamKeys
      expect(result).toBeTruthy()
      expect(result?.id).toBe('catch-all')
    })
  })
})