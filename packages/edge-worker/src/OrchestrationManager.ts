/**
 * OrchestrationManager - Manages parent-child issue relationships and orchestration flow
 * 
 * This service handles:
 * - Mapping between parent issues and their sub-issues
 * - Tracking agent sessions for each issue
 * - Managing cross-issue communication
 * - Monitoring sub-issue progress
 */

import { LinearClient } from '@linear/sdk';
import type { 
  LinearWebhook,
  LinearAgentSessionCreatedWebhook,
} from 'cyrus-core';

/**
 * Sub-issue tracking information
 */
export interface SubIssueTracker {
  /** The sub-issue ID in Linear */
  issueId: string;
  /** The sub-issue identifier (e.g., CEA-123) */
  issueIdentifier: string;
  /** The agent session ID if one exists */
  agentSessionId?: string;
  /** The Linear comment ID that started the agent session */
  commentId?: string;
  /** Current status of the sub-issue */
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'needs-revision';
  /** When this sub-issue was created */
  createdAt: Date;
  /** When this sub-issue was last updated */
  updatedAt: Date;
  /** The result/response from the agent session if completed */
  result?: string;
  /** Dependencies on other sub-issues (by ID) */
  dependencies?: string[];
  /** The label that determines which role handles this */
  roleLabel?: 'Bug' | 'Feature' | 'PRD' | 'Orchestration';
}

/**
 * Parent issue orchestration state
 */
export interface OrchestrationState {
  /** The parent issue ID */
  parentIssueId: string;
  /** The parent issue identifier */
  parentIssueIdentifier: string;
  /** The parent's agent session ID */
  parentAgentSessionId: string;
  /** The parent's comment ID */
  parentCommentId: string;
  /** List of sub-issues being orchestrated */
  subIssues: SubIssueTracker[];
  /** Current phase of orchestration */
  phase: 'planning' | 'executing' | 'integrating' | 'completed';
  /** When orchestration started */
  startedAt: Date;
  /** When orchestration was last updated */
  updatedAt: Date;
}

export class OrchestrationManager {
  private orchestrationStates: Map<string, OrchestrationState> = new Map();
  private subIssueToParentMap: Map<string, string> = new Map();
  
  constructor(
    private linearClient: LinearClient,
    private userAuthToken?: string, // Special token for cross-posting
  ) {}

  /**
   * Initialize orchestration for a parent issue
   */
  async initializeOrchestration(
    parentIssueId: string,
    parentIssueIdentifier: string,
    parentAgentSessionId: string,
    parentCommentId: string,
  ): Promise<OrchestrationState> {
    const state: OrchestrationState = {
      parentIssueId,
      parentIssueIdentifier,
      parentAgentSessionId,
      parentCommentId,
      subIssues: [],
      phase: 'planning',
      startedAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.orchestrationStates.set(parentIssueId, state);
    console.log(`[OrchestrationManager] Initialized orchestration for parent issue ${parentIssueIdentifier}`);
    
    return state;
  }

  /**
   * Register a sub-issue under a parent
   */
  async registerSubIssue(
    parentIssueId: string,
    subIssue: Omit<SubIssueTracker, 'createdAt' | 'updatedAt'>,
  ): Promise<SubIssueTracker> {
    const state = this.orchestrationStates.get(parentIssueId);
    if (!state) {
      throw new Error(`No orchestration state found for parent issue ${parentIssueId}`);
    }
    
    const tracker: SubIssueTracker = {
      ...subIssue,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    state.subIssues.push(tracker);
    state.updatedAt = new Date();
    
    // Map sub-issue to parent for reverse lookup
    this.subIssueToParentMap.set(subIssue.issueId, parentIssueId);
    
    console.log(`[OrchestrationManager] Registered sub-issue ${subIssue.issueIdentifier} under parent ${state.parentIssueIdentifier}`);
    
    return tracker;
  }

  /**
   * Update sub-issue status when agent session is created
   */
  async updateSubIssueSession(
    issueId: string,
    agentSessionId: string,
    commentId: string,
  ): Promise<void> {
    const parentIssueId = this.subIssueToParentMap.get(issueId);
    if (!parentIssueId) {
      // Not a tracked sub-issue, ignore
      return;
    }
    
    const state = this.orchestrationStates.get(parentIssueId);
    if (!state) {
      return;
    }
    
    const subIssue = state.subIssues.find(si => si.issueId === issueId);
    if (subIssue) {
      subIssue.agentSessionId = agentSessionId;
      subIssue.commentId = commentId;
      subIssue.status = 'in-progress';
      subIssue.updatedAt = new Date();
      state.updatedAt = new Date();
      
      console.log(`[OrchestrationManager] Updated sub-issue ${subIssue.issueIdentifier} with agent session ${agentSessionId}`);
    }
  }

  /**
   * Handle sub-issue completion and trigger next action
   */
  async handleSubIssueCompletion(
    issueId: string,
    result: string,
    success: boolean,
  ): Promise<void> {
    const parentIssueId = this.subIssueToParentMap.get(issueId);
    if (!parentIssueId) {
      return;
    }
    
    const state = this.orchestrationStates.get(parentIssueId);
    if (!state) {
      return;
    }
    
    const subIssue = state.subIssues.find(si => si.issueId === issueId);
    if (!subIssue) {
      return;
    }
    
    // Update sub-issue status
    subIssue.status = success ? 'completed' : 'failed';
    subIssue.result = result;
    subIssue.updatedAt = new Date();
    state.updatedAt = new Date();
    
    console.log(`[OrchestrationManager] Sub-issue ${subIssue.issueIdentifier} ${success ? 'completed' : 'failed'}`);
    
    // Post result back to parent issue if we have user auth token
    if (this.userAuthToken) {
      await this.postToParentIssue(state, subIssue, result, success);
    }
    
    // Determine next action
    await this.orchestrateNextStep(state);
  }

  /**
   * Post sub-issue result back to parent issue
   */
  private async postToParentIssue(
    state: OrchestrationState,
    subIssue: SubIssueTracker,
    result: string,
    success: boolean,
  ): Promise<void> {
    try {
      // Create a comment on the parent issue's agent session
      // This will trigger the parent's agent session to continue
      const message = `## Sub-Issue Update: ${subIssue.issueIdentifier}

Status: ${success ? '✅ Completed' : '❌ Failed'}

${success ? '### Result:' : '### Error:'}
${result}

---
*This is an automated update from sub-issue orchestration*`;

      // Use MutationAgentActivityCreatePromptArgs to create a prompt
      // that will trigger the parent agent session
      await this.linearClient.createAgentActivity({
        agentSessionId: state.parentAgentSessionId,
        content: {
          type: 'prompt',
          body: message,
        },
      });
      
      console.log(`[OrchestrationManager] Posted sub-issue result to parent ${state.parentIssueIdentifier}`);
    } catch (error) {
      console.error(`[OrchestrationManager] Failed to post to parent issue:`, error);
    }
  }

  /**
   * Determine and trigger the next orchestration step
   */
  private async orchestrateNextStep(state: OrchestrationState): Promise<void> {
    // Check if all sub-issues are complete
    const pendingSubIssues = state.subIssues.filter(
      si => si.status === 'pending' || si.status === 'in-progress'
    );
    
    if (pendingSubIssues.length === 0) {
      // All sub-issues complete, move to integration phase
      state.phase = 'integrating';
      console.log(`[OrchestrationManager] All sub-issues complete for ${state.parentIssueIdentifier}, moving to integration`);
      
      // Post summary to parent
      await this.postOrchestrationSummary(state);
      return;
    }
    
    // Find next sub-issue to execute (respecting dependencies)
    const nextSubIssue = this.findNextExecutableSubIssue(state);
    if (nextSubIssue) {
      console.log(`[OrchestrationManager] Next sub-issue to execute: ${nextSubIssue.issueIdentifier}`);
      
      // Assign the agent to the next sub-issue
      await this.assignAgentToSubIssue(nextSubIssue);
    }
  }

  /**
   * Find the next sub-issue that can be executed
   */
  private findNextExecutableSubIssue(state: OrchestrationState): SubIssueTracker | null {
    for (const subIssue of state.subIssues) {
      if (subIssue.status !== 'pending') {
        continue;
      }
      
      // Check if dependencies are satisfied
      if (subIssue.dependencies && subIssue.dependencies.length > 0) {
        const allDependenciesMet = subIssue.dependencies.every(depId => {
          const dep = state.subIssues.find(si => si.issueId === depId);
          return dep && dep.status === 'completed';
        });
        
        if (!allDependenciesMet) {
          continue;
        }
      }
      
      return subIssue;
    }
    
    return null;
  }

  /**
   * Assign the Cyrus agent to a sub-issue
   */
  private async assignAgentToSubIssue(subIssue: SubIssueTracker): Promise<void> {
    try {
      // Get the agent user ID (this would be configured)
      const agentUserId = process.env.LINEAR_AGENT_USER_ID;
      if (!agentUserId) {
        console.error('[OrchestrationManager] LINEAR_AGENT_USER_ID not configured');
        return;
      }
      
      // Assign the issue to the agent
      await this.linearClient.updateIssue(subIssue.issueId, {
        assigneeId: agentUserId,
      });
      
      console.log(`[OrchestrationManager] Assigned agent to sub-issue ${subIssue.issueIdentifier}`);
    } catch (error) {
      console.error(`[OrchestrationManager] Failed to assign agent to sub-issue:`, error);
    }
  }

  /**
   * Post orchestration summary to parent issue
   */
  private async postOrchestrationSummary(state: OrchestrationState): Promise<void> {
    const completed = state.subIssues.filter(si => si.status === 'completed');
    const failed = state.subIssues.filter(si => si.status === 'failed');
    
    const summary = `## Orchestration Summary

### Completed Sub-Issues (${completed.length})
${completed.map(si => `- ✅ ${si.issueIdentifier}: Completed successfully`).join('\n')}

### Failed Sub-Issues (${failed.length})
${failed.map(si => `- ❌ ${si.issueIdentifier}: Failed - needs revision`).join('\n')}

### Overall Status
${failed.length === 0 ? '✅ All sub-issues completed successfully!' : '⚠️ Some sub-issues failed and need attention'}

---
*Orchestration completed at ${new Date().toISOString()}*`;

    try {
      await this.linearClient.createAgentActivity({
        agentSessionId: state.parentAgentSessionId,
        content: {
          type: 'response',
          body: summary,
        },
      });
      
      state.phase = 'completed';
      console.log(`[OrchestrationManager] Posted orchestration summary to parent ${state.parentIssueIdentifier}`);
    } catch (error) {
      console.error(`[OrchestrationManager] Failed to post orchestration summary:`, error);
    }
  }

  /**
   * Check if an issue is being orchestrated
   */
  isOrchestrationParent(issueId: string): boolean {
    return this.orchestrationStates.has(issueId);
  }

  /**
   * Check if an issue is a tracked sub-issue
   */
  isTrackedSubIssue(issueId: string): boolean {
    return this.subIssueToParentMap.has(issueId);
  }

  /**
   * Get orchestration state for a parent issue
   */
  getOrchestrationState(parentIssueId: string): OrchestrationState | undefined {
    return this.orchestrationStates.get(parentIssueId);
  }

  /**
   * Get parent issue ID for a sub-issue
   */
  getParentIssueId(subIssueId: string): string | undefined {
    return this.subIssueToParentMap.get(subIssueId);
  }

  /**
   * Handle webhook events for orchestration
   */
  async handleWebhook(webhook: LinearWebhook): Promise<void> {
    // Handle agent session creation on sub-issues
    if (webhook.type === 'AgentSessionEvent' && webhook.action === 'created') {
      const agentSessionWebhook = webhook as LinearAgentSessionCreatedWebhook;
      const { agentSession } = agentSessionWebhook;
      
      if (agentSession && agentSession.issueId && agentSession.id && agentSession.commentId) {
        await this.updateSubIssueSession(
          agentSession.issueId,
          agentSession.id,
          agentSession.commentId,
        );
      }
    }
  }
}

export default OrchestrationManager;