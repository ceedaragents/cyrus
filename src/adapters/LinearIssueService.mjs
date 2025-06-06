import { IssueService } from '../services/IssueService.mjs';
import { Issue } from '../core/Issue.mjs';
import { LinearIssueSchema } from '../utils/schemas.mjs';

/**
 * Implementation of IssueService using the Linear API
 */
export class LinearIssueService extends IssueService {
  /**
   * @param {LinearClient} linearClient - Linear API client
   * @param {string} userId - ID of the agent user
   * @param {SessionManager} sessionManager - Manager for active sessions
   * @param {ClaudeService} claudeService - Service for Claude AI operations
   * @param {WorkspaceService} workspaceService - Service for workspace operations
   */
  constructor(linearClient, userId, sessionManager, claudeService, workspaceService) {
    super();
    this.linearClient = linearClient;
    this.userId = userId; // Can be null initially, will be populated from API
    this.username = null; // Will be populated from API
    this.sessionManager = sessionManager;
    this.claudeService = claudeService;
    this.workspaceService = workspaceService;
    this.isAuthenticated = false; // Track authentication status
  }
  
  /**
   * Convert Linear API issue to domain Issue
   * @param {import('../utils/schemas.mjs').LinearIssueType} linearIssue - Linear API issue
   * @returns {Issue} - Domain Issue
   */
  _convertToDomainIssue(linearIssue) {
    // Validate issue data against schema
    const validationResult = LinearIssueSchema.partial().safeParse(linearIssue);
    
    // Only log detailed validation info in debug mode
    if (!validationResult.success && process.env.DEBUG_LINEAR_API === 'true') {
      console.warn('Linear issue data does not match schema:', 
        validationResult.error.format()
      );
      // Continue with the conversion, but log the validation error
    }
    
    // Extract and format comments (without logging)
    let comments = [];
    if (Array.isArray(linearIssue.comments)) {
      comments = linearIssue.comments.map(comment => ({
        id: comment.id,
        body: comment.body,
        userId: comment.user?.id,
        userName: comment.user?.name || 'Unknown',
        createdAt: comment.createdAt
      }));
    }
    
    return new Issue({
      id: linearIssue.id,
      identifier: linearIssue.identifier,
      title: linearIssue.title,
      description: linearIssue.description,
      state: linearIssue.state?.name || linearIssue.state,
      stateType: linearIssue.state?.type,
      priority: linearIssue.priority,
      url: linearIssue.url,
      assigneeId: linearIssue.assignee?.id || linearIssue._assignee?.id || linearIssue.assigneeId,
      comments: comments,
      branchName: linearIssue.branchName
    });
  }
  
  /**
   * @inheritdoc
   */
  async fetchAssignedIssues() {
    try {
      // Ensure we have user ID from API before proceeding
      if (!this.userId && this.fetchUserData) {
        console.log('No user ID available, fetching from API first...');
        const success = await this.fetchUserData();
        if (!success || !this.userId) {
          console.error('Could not automatically determine the agent user ID. Will attempt to fetch all open issues instead.');
          
          // If we didn't get a user ID, try a different approach: get all open issues
          console.log('Fetching all open issues as a fallback...');
          const allIssues = await this.linearClient.issues({
            filter: {
              state: { type: { nin: ['canceled', 'completed'] } },
            },
            first: 50
          });
          
          if (allIssues && allIssues.nodes && allIssues.nodes.length > 0) {
            console.log(`Found ${allIssues.nodes.length} open issues.`);
            this.isAuthenticated = true;
            return allIssues.nodes.map(issue => this._convertToDomainIssue(issue))
              .filter(issue => issue.assigneeId === this.userId);
          } else {
            console.log('No issues found in fallback query.');
            return [];
          }
        }
      }
      
      if (!this.userId) {
        console.error('No user ID available - will return an empty list of assigned issues');
        return [];
      }
      
      console.log(`Fetching issues assigned to user ID: ${this.userId}`);
      const issues = await this.linearClient.issues({
        filter: {
          assignee: { id: { eq: this.userId } },
          state: { type: { nin: ['canceled', 'completed'] } },
        },
      });
      
      // If we get here, we're authenticated
      this.isAuthenticated = true;
      console.log('✅ Authenticated successfully with Linear API');
      
      return issues.nodes.map(issue => this._convertToDomainIssue(issue));
    } catch (error) {
      this.isAuthenticated = false;
      
      // Handle authentication errors gracefully
      if (error.type === 'AuthenticationError' || 
          (error.message && error.message.includes('Authentication required'))) {
        console.log('⚠️ Please authenticate with Linear to fetch issues.');
        throw new Error(`Authentication required. Please use the OAuth flow to authenticate with Linear.`);
      } else {
        // For other errors, provide a concise message
        console.error(`Error fetching assigned issues: ${error.message || String(error)}`);
        throw error;
      }
    }
  }
  
  /**
   * Check if the service is authenticated with Linear
   * @returns {boolean} - Authentication status
   */
  getAuthStatus() {
    return this.isAuthenticated;
  }
  
  /**
   * @inheritdoc
   */
  async fetchIssue(issueId) {
    try {
      // Fetch the issue details
      const issueResponse = await this.linearClient.issue(issueId);
      
      // Fetch comments for the issue
      const commentsResponse = await this.linearClient.issueComments(issueId);
      const commentCount = commentsResponse?.comments?.nodes?.length || 0;
      
      // Only log detailed info if debug mode is enabled
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.log(`===== FETCHING ISSUE: ${issueId} =====`);
        console.log(`Fetched issue: ${issueResponse.identifier} - ${issueResponse.title}`);
        console.log(`Fetched ${commentCount} comments for issue ${issueResponse.identifier}`);
      }
      
      // Create a modified issue object with comments
      const issueWithComments = {
        ...issueResponse,
        comments: commentsResponse?.comments?.nodes || []
      };
      
      // Convert to domain issue
      return this._convertToDomainIssue(issueWithComments);
    } catch (error) {
      console.error(`Error fetching issue ${issueId}:`, error);
      throw error;
    }
  }
  
  /**
   * Find the root comment of a thread
   * @param {string} issueId - The issue ID
   * @param {string} commentId - The comment ID to find the root for
   * @returns {Promise<string|null>} - Root comment ID or null if not found/error
   */
  async findRootCommentId(issueId, commentId) {
    try {
      // Fetch comments for the issue
      const commentsResponse = await this.linearClient.issueComments(issueId);
      const comments = commentsResponse?.comments?.nodes || [];
      
      if (!comments.length) {
        return null;
      }
      
      // Find the comment we're looking for
      const targetComment = comments.find(c => c.id === commentId);
      if (!targetComment) {
        return null;
      }
      
      // If it has no parent, it's already a root comment
      if (!targetComment.parent?.id) {
        return commentId;
      }
      
      // Walk up the chain to find the root
      let currentComment = targetComment;
      const visited = new Set([commentId]); // Prevent infinite loops
      
      while (currentComment.parent?.id && !visited.has(currentComment.parent.id)) {
        visited.add(currentComment.parent.id);
        currentComment = comments.find(c => c.id === currentComment.parent.id);
        
        if (!currentComment) {
          // Parent not found in the comments list, return the last known comment
          break;
        }
        
        // If this comment has no parent, it's the root
        if (!currentComment.parent?.id) {
          return currentComment.id;
        }
      }
      
      // If we got here, either we found the root or hit a loop/missing parent
      return currentComment?.id || null;
    } catch (error) {
      console.error(`Error finding root comment for ${commentId} in issue ${issueId}:`, error);
      return null;
    }
  }

  /**
   * Create a comment and return its ID
   * @param {string} issueId - The issue ID
   * @param {string} body - The comment body
   * @param {string} parentId - Optional parent comment ID for threading
   * @returns {Promise<{success: boolean, commentId?: string}>} - Result with comment ID if successful
   */
  async createCommentAndGetId(issueId, body, parentId = null) {
    // Calculate body length and create a preview for logging
    const bodyLength = body.length;
    const bodyPreview = bodyLength > 50 ? body.substring(0, 50) + '...' : body;
    
    console.log(`===== CREATING COMMENT ON ISSUE ${issueId} =====`);
    console.log(`Comment length: ${bodyLength} characters, Preview: ${bodyPreview}`);
    if (parentId) {
      console.log(`Replying to parent comment: ${parentId}`);
    }
    
    // Only log full comment body in debug mode
    if (process.env.DEBUG_COMMENT_CONTENT === 'true') {
      console.log('Full comment body:', body);
    }
    
    try {
      console.log('Sending comment to Linear API...');
      const commentData = {
        issueId,
        body,
      };
      
      // Add parentId if provided to create a threaded reply
      if (parentId) {
        commentData.parentId = parentId;
      }
      
      const response = await this.linearClient.createComment(commentData);
      
      // Only log detailed API response in debug mode
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.log('Linear API response for createComment:');
        console.log(JSON.stringify(response, null, 2));
      }
      
      // Extract comment ID from response - Linear API returns it in _comment.id
      const commentId = response?._comment?.id || response?.comment?.id || response?.commentCreate?.comment?.id;
      
      console.log(`✅ Successfully created comment on issue ${issueId}`);
      if (commentId) {
        console.log(`Comment ID: ${commentId}`);
      }
      
      return { success: true, commentId };
    } catch (error) {
      console.error(`Failed to create comment on issue ${issueId}:`, error);
      
      // Only log detailed error in debug mode
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      return { success: false };
    }
  }
  
  /**
   * Update an existing comment
   * @param {string} commentId - The comment ID to update
   * @param {string} body - The new comment body
   * @returns {Promise<boolean>} - Success status
   */
  async updateComment(commentId, body) {
    // Calculate body length and create a preview for logging
    const bodyLength = body.length;
    const bodyPreview = bodyLength > 50 ? body.substring(0, 50) + '...' : body;
    
    console.log(`===== UPDATING COMMENT ${commentId} =====`);
    console.log(`Comment length: ${bodyLength} characters, Preview: ${bodyPreview}`);
    
    // Only log full comment body in debug mode
    if (process.env.DEBUG_COMMENT_CONTENT === 'true') {
      console.log('Full comment body:', body);
    }
    
    try {
      console.log('Sending comment update to Linear API...');
      
      const response = await this.linearClient.updateComment(commentId, { body });
      
      // Only log detailed API response in debug mode
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.log('Linear API response for updateComment:');
        console.log(JSON.stringify(response, null, 2));
      }
      
      console.log(`✅ Successfully updated comment ${commentId}`);
      return true;
    } catch (error) {
      console.error(`Failed to update comment ${commentId}:`, error);
      
      // Only log detailed error in debug mode
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      return false;
    }
  }

  /**
   * @inheritdoc
   */
  async createComment(issueId, body, parentId = null) {
    // Calculate body length and create a preview for logging
    const bodyLength = body.length;
    const bodyPreview = bodyLength > 50 ? body.substring(0, 50) + '...' : body;
    
    console.log(`===== CREATING COMMENT ON ISSUE ${issueId} =====`);
    console.log(`Comment length: ${bodyLength} characters, Preview: ${bodyPreview}`);
    if (parentId) {
      console.log(`Replying to parent comment: ${parentId}`);
    }
    
    // Only log full comment body in debug mode
    if (process.env.DEBUG_COMMENT_CONTENT === 'true') {
      console.log('Full comment body:', body);
    }
    
    try {
      console.log('Sending comment to Linear API...');
      const commentData = {
        issueId,
        body,
      };
      
      // Add parentId if provided to create a threaded reply
      if (parentId) {
        commentData.parentId = parentId;
      }
      
      const result = await this.createCommentAndGetId(issueId, body, parentId);
      return result.success;
    } catch (error) {
      console.error(`Failed to create comment on issue ${issueId}:`, error);
      
      // Only log detailed error in debug mode
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      return false;
    }
  }
  
  /**
   * Initialize a session for an issue
   * @param {Issue} issue - The issue to initialize
   * @param {boolean} isStartupInit - Whether this is a system startup initialization
   * @param {string} agentRootCommentId - Optional first comment ID for threading
   */
  async initializeIssueSession(issue, isStartupInit = false, agentRootCommentId = null) {
    // Skip if we already have an active session
    if (this.sessionManager.hasSession(issue.id)) {
      console.log(`Already have an active session for issue ${issue.identifier}`);
      return;
    }
    
    try {
      // Check if workspace already exists
      let workspace = await this.workspaceService.getWorkspaceForIssue(issue);
      if (!workspace) {
        // No existing workspace, create a new one and start a session
        console.log(`Creating workspace for issue ${issue.identifier}`);
        workspace = await this.workspaceService.createWorkspace(issue);
        
        // Start a Claude session for the new workspace
        console.log(`Starting Claude session for issue ${issue.identifier} with agent user ID: ${this.userId}`);
        const session = await this.claudeService.startSession(issue, workspace, agentRootCommentId);
        
        // Store session
        this.sessionManager.addSession(issue.id, session);
      } else {
        // Workspace already exists
        if (isStartupInit) {
          // On startup, skip automatic session start for existing workspaces
          console.log(`Workspace already exists for issue ${issue.identifier}. Skipping automatic Claude session start.`);
        } else {
          // For comment/mention triggers, always start a session
          console.log(`Starting Claude session for issue ${issue.identifier} with existing workspace`);
          const session = await this.claudeService.startSession(issue, workspace, agentRootCommentId);
          this.sessionManager.addSession(issue.id, session);
        }
      }
    } catch (error) {
      console.error(error);
      console.error(`Error setting up session for issue ${issue.identifier}:`, error.message);
      
      // Post error as a Linear comment
      try {
        await this.createComment(
          issue.id,
          `Claude agent encountered an error while processing issue ${issue.identifier}:\n\n\`\`\`\n${error.message}\n\`\`\``
        );
      } catch (commentError) {
        console.error(`Failed to post error comment to Linear: ${commentError.message}`);
      }
    }
  }
  
  /**
   * @inheritdoc
   */
  async handleIssueCreateEvent(issueData) {
    try {
      console.log('===== PROCESSING ISSUE CREATE EVENT =====');
      console.log('Issue Create Data:');
      console.log(JSON.stringify(issueData, null, 2));
      
      console.log(
        `===== WEBHOOK: Received issue creation event for ${
          issueData.identifier || issueData.id
        } =====`
      );
      
      // Check if the issue is assigned to our agent
      console.log(`Issue assignee ID: ${issueData.assigneeId || 'null (unassigned)'}`);
      console.log(`Our agent user ID: ${this.userId}`);
      
      if (issueData.assigneeId !== this.userId) {
        console.log(
          `New issue ${
            issueData.identifier || issueData.id
          } is not assigned to our agent, skipping`
        );
        return;
      }
      
      console.log(
        `New issue ${
          issueData.identifier || issueData.id
        } is assigned to our agent, processing immediately`
      );
      
      // Fetch complete issue data
      const issue = await this.fetchIssue(issueData.id);
      
      // Process the issue right away
      await this.initializeIssueSession(issue);
      
      console.log(
        `✅ Successfully initiated processing for new issue ${issue.identifier}`
      );
    } catch (error) {
      console.error('Error handling issue creation event:', error);
    }
  }
  
  /**
   * @inheritdoc
   */
  async handleIssueUpdateEvent(issueData) {
    try {
      console.log('===== PROCESSING ISSUE UPDATE EVENT =====');
      console.log('Issue Update Data:');
      console.log(JSON.stringify(issueData, null, 2));
      
      console.log(
        `===== WEBHOOK: Received issue update for ${
          issueData.identifier || issueData.id
        } =====`
      );
      
      // Check if the issue state was changed to canceled
      if (issueData.state && issueData.state.type === 'canceled') {
        console.log(`Issue ${issueData.identifier || issueData.id} has been canceled`);
        
        // Check if we have an active session for this issue
        if (this.sessionManager.hasSession(issueData.id)) {
          const session = this.sessionManager.getSession(issueData.id);
          
          console.log(`Issue ${session.issue.identifier} has been canceled, terminating Claude process`);
          
          // Post a comment acknowledging the cancellation
          try {
            await this.createComment(
              issueData.id,
              `I will stop working on this. If you ever reopen it, I will start again.`
            );
          } catch (commentError) {
            console.error(`Failed to post cancellation comment: ${commentError.message}`);
          }
          
          // Kill the Claude process
          if (session.process && !session.process.killed) {
            try {
              session.process.kill('SIGTERM');
              console.log(`✅ Terminated Claude process for canceled issue ${session.issue.identifier}`);
            } catch (killError) {
              console.error(
                `Error terminating Claude process for canceled issue ${session.issue.identifier}:`,
                killError
              );
            }
          }
          
          // Remove the session
          this.sessionManager.removeSession(issueData.id);
          console.log(`Session removed for canceled issue ${session.issue.identifier}`);
        }
      }
      
      // Check if the assignee was changed
      if ('assigneeId' in issueData) {
        const newAssigneeId = issueData.assigneeId;
        console.log(`Detected assignee change. New assignee ID: ${newAssigneeId || 'null (unassigned)'}`);
        console.log(`Our agent user ID: ${this.userId}`);
        
        // Check if we have an active session for this issue
        if (this.sessionManager.hasSession(issueData.id)) {
          const session = this.sessionManager.getSession(issueData.id);
          const previousAssigneeId = session.issue.assigneeId;
          
          console.log(`Previous assignee ID: ${previousAssigneeId || 'null (unassigned)'}`);
          
          // If the issue was assigned to our agent but now isn't
          if (
            previousAssigneeId === this.userId &&
            (newAssigneeId === null || newAssigneeId !== this.userId)
          ) {
            console.log(
              `Issue ${session.issue.identifier} has been unassigned from our agent, terminating Claude process`
            );
            
            // Kill the Claude process
            if (session.process && !session.process.killed) {
              try {
                // Post a comment to Linear before killing the process
                await this.createComment(
                  issueData.id,
                  `This issue has been unassigned from the agent. The Claude process is being terminated.`
                );
                
                // Kill the process
                session.process.kill('SIGTERM');
                console.log(
                  `✅ Terminated Claude process for issue ${session.issue.identifier}`
                );
              } catch (killError) {
                console.error(
                  `Error terminating Claude process for issue ${session.issue.identifier}:`,
                  killError
                );
              }
            } else {
              console.log(
                `No active Claude process to kill for issue ${session.issue.identifier}`
              );
            }
          }
        }
        
        // If the issue is newly assigned to our agent
        if (
          newAssigneeId === this.userId
        ) {
          console.log(
            `Issue ${
              issueData.identifier || issueData.id
            } has been assigned to our agent, starting Claude process`
          );
          
          // Fetch complete issue data
          const issue = await this.fetchIssue(issueData.id);
          
          // Process the issue right away
          await this.initializeIssueSession(issue);
          
          console.log(
            `✅ Successfully initiated processing for newly assigned issue ${issue.identifier}`
          );
        }
      }
    } catch (error) {
      console.error('Error handling issue update event:', error);
    }
  }
  
  /**
   * @inheritdoc
   */
  async handleCommentEvent(commentData) {
    try {
      console.log('===== PROCESSING COMMENT EVENT =====');
      console.log('Comment Data:');
      console.log(JSON.stringify(commentData, null, 2));
      
      // Get the issue ID from the comment event
      const { issueId, body, user } = commentData;
      
      console.log(`Issue ID: ${issueId}`);
      console.log(`Comment body: ${body}`);
      console.log(`User ID: ${user.id}`);
      console.log(`User name: ${user.name || 'Not provided'}`);
      
      // CRITICAL: Skip comments created by our own user to prevent infinite loops
      // This check has been duplicated in ExpressWebhookService.mjs as a double-protection
      if (user.id === this.userId) {
        // Only log this in debug mode to reduce verbosity
        if (process.env.DEBUG_SELF_WEBHOOKS === 'true') {
          console.log(`⚠️ Skipping comment from our own user (${user.id}) to prevent infinite loop`);
        }
        return;
      }
      
      // Fetch issue details first to check status
      console.log('Fetching issue details to check status...');
      const issue = await this.fetchIssue(issueId);
      console.log('Issue details:');
      console.log(JSON.stringify(issue, null, 2));
      
      // Check if the issue is canceled
      const isCanceled = issue.stateType === 'canceled';
      
      // Use the username from the API for mention checking
      console.log(`Checking for agent mention. Agent username: ${this.username}`);
      const hasAgentMention = this.username && body.includes(this.username);
      
      // If issue is canceled and there's no agent mention, ignore the comment
      if (isCanceled && !hasAgentMention) {
        console.log(
          `Skipping comment on canceled issue ${issue.identifier} that does not mention the agent`
        );
        return;
      }
      
      // In the legacy webhook format, we still want to check for mentions
      // But for new Agent API notifications, this is handled based on notification type
      if (!isCanceled && this.username && !hasAgentMention) {
        console.log(
          `Skipping comment that does not mention the agent (${this.username})`
        );
        return;
      }
      
      if (issue.assigneeId !== this.userId) {
        console.log(
          `Skipping comment on issue ${issue.identifier} that is not assigned to our agent`
        );
        return;
      }
      
      console.log(
        `===== WEBHOOK: Received comment on assigned issue ${issueId} that mentions ${this.username}. Processing... =====`
      );
      
      // Get the session info, if it exists
      const session = this.sessionManager.getSession(issueId);
      
      if (session) {
        // Session exists, send the comment
        try {
          // Update threading context based on comment structure
          if (commentData.parentId) {
            // If the comment is already threaded, find the root of that thread
            // Linear API requires parentId to be a top-level comment
            const rootCommentId = await this.findRootCommentId(issueId, commentData.id);
            session.currentParentId = rootCommentId || commentData.parentId;
          } else {
            // If it's a root comment from user, reply to this comment
            session.currentParentId = commentData.id;
          }
          session.lastCommentId = commentData.id;
          session.conversationContext = 'reply';
          
          const updatedSession = await this.claudeService.sendComment(session, body);
          this.sessionManager.updateSession(issueId, updatedSession);
          
          console.log(
            `✅ Comment successfully sent to Claude for issue ${issue.id}`
          );
          console.log(
            `Claude is processing the comment and will post a response to Linear when ready.`
          );
        } catch (err) {
          console.error(`Failed to send comment to Claude: ${err.message}`);
          
          // Post an error comment back to Linear
          try {
            await this.createComment(
              issue.id,
              `Agent encountered an error trying to process your comment: ${err.message}`
            );
          } catch (commentError) {
            console.error(
              `Failed to post error comment to Linear for issue ${issue.id}:`,
              commentError
            );
          }
        }
      } else {
        console.error(
          `Could not find valid session for the issue ${issueId}. Reinitializing...`
        );
        
        // Try to initialize a new session with the user's comment as threading context
        // If it's a root comment from user, we should thread agent responses under it
        const agentRootCommentId = commentData.parentId ? null : commentData.id;
        await this.initializeIssueSession(issue, false, agentRootCommentId);
      }
    } catch (error) {
      console.error('Error handling comment event:', error);
    }
  }
  
  /**
   * @inheritdoc
   */
  async handleAgentMention(data) {
    try {
      console.log('===== PROCESSING AGENT MENTION NOTIFICATION =====');
      
      // Extract relevant information from notification data
      const issueId = data.issueId;
      const commentId = data.commentId;
      const commentContent = data.comment?.body;
      const actor = data.actor?.name || 'Unknown user';
      
      console.log(`Agent mentioned by ${actor} in comment ${commentId} on issue ${issueId}`);
      if (commentContent) {
        console.log(`Comment content (preview): ${commentContent.substring(0, 100)}${commentContent.length > 100 ? '...' : ''}`);
      }
      
      if (!issueId) {
        console.log('No issue ID found in mention data, cannot process');
        return;
      }
      
      // Fetch the issue to get full context
      const issue = await this.fetchIssue(issueId);
      console.log(`Fetched issue: ${issue.identifier}`);
      
      // Check if the issue is still assigned to our agent
      if (issue.assigneeId !== this.userId) {
        console.log(
          `Skipping mention on issue ${issue.identifier} that is not assigned to our agent`
        );
        return;
      }
      
      // Check if we already have a session for this issue
      if (this.sessionManager.hasSession(issueId)) {
        console.log(`Using existing session for issue ${issue.identifier}`);
        const session = this.sessionManager.getSession(issueId);
        
        // Process the mention as a comment (using commentContent from data.comment.body)
        if (commentContent) {
          console.log(`Processing mention as a comment: ${commentContent.substring(0, 50)}${commentContent.length > 50 ? '...' : ''}`);
          
          // Update threading context based on mention location
          // For mentions, we need to check the comment data for parent info
          if (data.comment?.parentId) {
            // If the mention is in a threaded comment, find the root of that thread
            // Linear API requires parentId to be a top-level comment
            const rootCommentId = await this.findRootCommentId(issueId, commentId);
            session.currentParentId = rootCommentId || data.comment.parentId;
          } else {
            // If it's a root comment mention, reply to this comment
            session.currentParentId = commentId;
          }
          session.lastCommentId = commentId;
          session.conversationContext = 'mention';
          
          // Ensure we're using the correct variable (commentContent, not content)
          const updatedSession = await this.claudeService.sendComment(session, commentContent);
          this.sessionManager.updateSession(issueId, updatedSession);
        }
      } else {
        // Initialize a new session for this issue
        console.log(`No existing session for issue ${issue.identifier}, initializing new session`);
        
        // If it's a root comment mention, thread agent responses under it
        const agentRootCommentId = data.comment?.parentId ? null : commentId;
        await this.initializeIssueSession(issue, false, agentRootCommentId);
      }
      
      console.log('Successfully processed agent mention');
    } catch (error) {
      console.error('Error handling agent mention:', error);
    }
  }
  
  /**
   * @inheritdoc
   */
  async handleAgentAssignment(data) {
    try {
      // Extract relevant information from notification data
      const { issueId } = data;
      const actor = data.actor?.name || 'Unknown user';
      const issueIdentifier = data.issue?.identifier || '';
      
      // Concise logging of assignment
      console.log(`📋 Agent assigned to issue ${issueIdentifier} by ${actor}`);
      
      if (!issueId) {
        console.log('No issue ID found in assignment data, cannot process');
        return;
      }
      
      // Fetch the issue to get full context (detailed debug logs are in fetchIssue)
      const issue = await this.fetchIssue(issueId);
      
      // Move the issue to "started" state (In Progress)
      try {
        await this.moveIssueToInProgress(issueId);
        console.log(`✅ Moved issue ${issue.identifier} to "started" state`);
      } catch (stateError) {
        console.error(`Failed to move issue to "started" state: ${stateError.message}`);
        // Continue processing even if state change fails
      }
      
      // Best practice - Post an acknowledgement comment
      const firstCommentResult = await this.createCommentAndGetId(
        issueId,
        `I'm now assigned to this issue and will start working on it right away.`
      );
      
      // Initialize a session for this issue with the first comment ID
      if (firstCommentResult?.success && firstCommentResult?.commentId) {
        console.log(`Starting work on issue ${issue.identifier}`);
        await this.initializeIssueSession(issue, false, firstCommentResult.commentId);
      } else {
        console.log(`Starting work on issue ${issue.identifier} (no comment ID available)`);
        await this.initializeIssueSession(issue, false);
      }
    } catch (error) {
      console.error('Error handling agent assignment:', error);
    }
  }
  
  /**
   * @inheritdoc
   */
  async handleAgentReply(data) {
    try {
      console.log('===== PROCESSING AGENT REPLY NOTIFICATION =====');
      
      // Extract relevant information from notification data using safer property access
      const issueId = data.issueId;
      const commentId = data.commentId;
      const commentContent = data.comment?.body;
      const actor = data.actor?.name || 'Unknown user';
      
      console.log(`Reply from ${actor} on issue ${data.issue?.identifier || issueId}`);
      if (commentContent) {
        console.log(`Comment preview: ${commentContent.substring(0, 50)}${commentContent.length > 50 ? '...' : ''}`);
      }
      
      if (!issueId) {
        console.log('No issue ID found in reply data, cannot process');
        return;
      }
      
      // Fetch the issue to get full context
      const issue = await this.fetchIssue(issueId);
      console.log(`Fetched issue: ${issue.identifier}`);
      
      // Check if the issue is canceled - for replies on canceled issues, we should ignore them
      const isCanceled = issue.stateType === 'canceled';
      if (isCanceled) {
        console.log(`Skipping reply on canceled issue ${issue.identifier}`);
        return;
      }
      
      // Check if we have a session for this issue
      if (this.sessionManager.hasSession(issueId)) {
        console.log(`Using existing session for issue ${issue.identifier}`);
        const session = this.sessionManager.getSession(issueId);
        
        // Process the reply as a comment
        if (commentContent) {
          console.log(`Processing reply as a comment`);
          
          // Update threading context for replies
          // For replies, check if this is a threaded reply
          if (data.comment?.parentId) {
            // If replying in a thread, find the root of that thread
            // Linear API requires parentId to be a top-level comment
            const rootCommentId = await this.findRootCommentId(issueId, commentId);
            session.currentParentId = rootCommentId || data.comment.parentId;
          } else {
            // If it's a root comment reply, reply to this comment
            session.currentParentId = commentId;
          }
          session.lastCommentId = commentId;
          session.conversationContext = 'reply';
          
          const updatedSession = await this.claudeService.sendComment(session, commentContent);
          this.sessionManager.updateSession(issueId, updatedSession);
        }
      } else {
        // Initialize a new session for this issue
        console.log(`No existing session for issue ${issue.identifier}, initializing new session`);
        
        // If it's a root comment reply, thread agent responses under it
        const agentRootCommentId = data.comment?.parentId ? null : commentId;
        await this.initializeIssueSession(issue, false, agentRootCommentId);
      }
      
      console.log('Successfully processed agent reply');
    } catch (error) {
      console.error('Error handling agent reply:', error);
    }
  }

  /**
   * @inheritdoc
   */
  async handleAgentUnassignment(data) {
    try {
      console.log('===== PROCESSING AGENT UNASSIGNMENT NOTIFICATION =====');
      const { issueId, issue, actor } = data;
      
      console.log(`Agent unassigned from issue ${issue.identifier} by ${actor.name}`);
      
      // Check if we have an active session for this issue
      if (this.sessionManager.hasSession(issueId)) {
        const session = this.sessionManager.getSession(issueId);
        
        // Terminate the Claude process if it's running
        if (session.process && !session.process.killed) {
          console.log(`Terminating Claude process for issue ${issue.identifier}`);
          session.process.kill();
        }
        
        // Remove the session from the manager
        this.sessionManager.removeSession(issueId);
        console.log(`Session removed for issue ${issue.identifier}`);
        
        // Post a final comment to Linear
        try {
          await this.createComment(
            issueId,
            `[System] Agent has been unassigned from this issue by ${actor.name}. Terminating active work session.`
          );
        } catch (commentError) {
          console.error(`Failed to post unassignment comment to Linear: ${commentError.message}`);
        }
      } else {
        console.log(`No active session found for issue ${issue.identifier}`);
      }
      
      console.log('Successfully processed agent unassignment');
    } catch (error) {
      console.error('Error handling agent unassignment:', error);
    }
  }
  
  /**
   * Move an issue to "In Progress" state
   * @param {string} issueId - The ID of the issue to update
   * @returns {Promise<void>}
   */
  async moveIssueToInProgress(issueId) {
    try {
      // First, fetch the issue to get its team ID
      const issue = await this.linearClient.issue(issueId);
      
      if (!issue || !issue.team) {
        throw new Error('Could not fetch issue or issue has no team');
      }
      
      // Get the team's workflow states
      const team = await issue.team;
      const states = await team.states();
      
      // Find all states with type "started" and pick the one with lowest position
      // This ensures we pick "In Progress" over "In Review" when both have type "started"
      // Linear uses standardized state types: triage, backlog, unstarted, started, completed, canceled
      const startedStates = states.nodes.filter(state => state.type === 'started');
      const startedState = startedStates.sort((a, b) => a.position - b.position)[0];
      
      if (!startedState) {
        throw new Error('Could not find a state with type "started" for this team');
      }
      
      // Update the issue state to the "started" state
      await this.linearClient.updateIssue(issueId, {
        stateId: startedState.id
      });
      
      if (process.env.DEBUG_LINEAR_API === 'true') {
        console.log(`Successfully updated issue ${issueId} to "${startedState.name}" state (type: started)`);
      }
    } catch (error) {
      console.error(`Error moving issue to "In Progress": ${error.message}`);
      throw error;
    }
  }
}