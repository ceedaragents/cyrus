# @cyrus/edge-worker

Unified edge worker for processing Linear issues with Claude. Handles webhook events, manages Claude sessions, and posts comments back to Linear.

## Installation

```bash
pnpm add @cyrus/edge-worker
```

## Usage

The EdgeWorker supports multiple repository/Linear workspace pairs. Each repository configuration includes:
- Git repository path and branch
- Linear workspace ID and OAuth token
- Workspace directory for issue processing

### Single Repository Example (CLI)

```typescript
import { EdgeWorker } from '@cyrus/edge-worker'

const edgeWorker = new EdgeWorker({
  // Connection
  proxyUrl: 'https://edge-proxy.example.com',
  
  // Claude
  claudePath: '/usr/local/bin/claude',
  defaultAllowedTools: ['bash', 'edit', 'read'],
  
  // Single repository configuration
  repositories: [{
    id: 'main-repo',
    name: 'Main Repository',
    repositoryPath: '/home/user/projects/main',
    baseBranch: 'main',
    linearWorkspaceId: 'workspace-123',
    linearToken: await oauthHelper.getAccessToken(),
    workspaceBaseDir: '/home/user/.cyrus/workspaces/main'
  }],
  
  // Optional handlers
  handlers: {
    // Custom workspace creation (e.g., git worktrees)
    createWorkspace: async (issue, repository) => {
      const path = await createGitWorktree(
        repository.repositoryPath,
        issue.identifier,
        repository.baseBranch
      )
      return { path, isGitWorktree: true }
    },
    
    // Log errors
    onError: (error) => {
      console.error('EdgeWorker error:', error)
    }
  },
  
  // Features
  features: {
    enableContinuation: true,
    enableTokenLimitHandling: true
  }
})

// Start processing
await edgeWorker.start()
```

### Multi-Repository Example (Electron)

```typescript
import { EdgeWorker } from '@cyrus/edge-worker'

// Load repository configurations from user settings
const repositories = userSettings.repositories.map(repo => ({
  id: repo.id,
  name: repo.name,
  repositoryPath: repo.path,
  baseBranch: repo.branch || 'main',
  linearWorkspaceId: repo.linearWorkspaceId,
  linearToken: repo.linearToken, // Each repo can have its own token
  workspaceBaseDir: path.join(app.getPath('userData'), 'workspaces', repo.id),
  isActive: repo.enabled
}))

const edgeWorker = new EdgeWorker({
  proxyUrl: config.proxyUrl,
  claudePath: getClaudePath(),
  
  // Multiple repositories
  repositories,
  
  // UI updates with repository context
  handlers: {
    onClaudeEvent: (issueId, event, repositoryId) => {
      // Update UI with Claude's progress
      mainWindow.webContents.send('claude-event', { 
        issueId, 
        event,
        repository: repositories.find(r => r.id === repositoryId)
      })
    },
    
    onSessionStart: (issueId, issue, repositoryId) => {
      const repo = repositories.find(r => r.id === repositoryId)
      // Show notification
      new Notification({
        title: `Processing Issue in ${repo.name}`,
        body: `Working on ${issue.identifier}: ${issue.title}`
      }).show()
    },
    
    createWorkspace: async (issue, repository) => {
      // Create git worktree for the specific repository
      const worktreePath = await createWorktree(
        repository.repositoryPath,
        issue.identifier,
        repository.baseBranch
      )
      return { path: worktreePath, isGitWorktree: true }
    }
  }
})

await edgeWorker.start()
```

## Configuration

### Required Config

- `proxyUrl`: URL of the edge proxy server
- `claudePath`: Path to Claude CLI executable
- `repositories`: Array of repository configurations

### Repository Configuration

Each repository in the `repositories` array requires:

- `id`: Unique identifier for the repository
- `name`: Display name for the repository
- `repositoryPath`: Local git repository path
- `baseBranch`: Branch to create worktrees from (e.g., 'main')
- `linearWorkspaceId`: Linear workspace/team ID
- `linearToken`: OAuth token for this Linear workspace
- `workspaceBaseDir`: Where to create issue workspaces

Optional per-repository settings:
- `isActive`: Whether to process webhooks (default: true)
- `promptTemplatePath`: Custom prompt template for this repo
- `teamKeys`: Array of Linear team keys for team-based routing (e.g., ["FE", "UI"])
- `labelPrompts`: Label-based AI mode selection (debugger, builder, scoper)
- `routingLabels`: Label-based repository routing configuration

### Optional Handlers

All handlers are optional and now include repository context:

- `createWorkspace(issue, repository)`: Custom workspace creation
- `onClaudeEvent(issueId, event, repositoryId)`: Claude event updates
- `onSessionStart(issueId, issue, repositoryId)`: Session started
- `onSessionEnd(issueId, exitCode, repositoryId)`: Session ended
- `onError(error, context)`: Error handling

### Features

- `enableContinuation`: Use `--continue` flag for follow-up comments (default: true)
- `enableTokenLimitHandling`: Auto-restart on token limits (default: true)
- `enableAttachmentDownload`: Download issue attachments (default: false)

## Events

The EdgeWorker extends EventEmitter and emits:

- `connected`: Connected to proxy (token)
- `disconnected`: Disconnected from proxy (token, reason)
- `session:started`: Claude session started (issueId, issue, repositoryId)
- `session:ended`: Claude session ended (issueId, exitCode, repositoryId)
- `claude:event`: Any Claude event (issueId, event, repositoryId)
- `claude:response`: Claude text response (issueId, text, repositoryId)
- `claude:tool-use`: Claude used a tool (issueId, tool, input, repositoryId)
- `error`: Error occurred (error, context)

## Architecture

```
Your App (CLI/Electron)
    ↓ provides repository configs
EdgeWorker
    ↓ manages multiple repositories
    ├─→ Repository 1 (token A) ─→ Linear Workspace 1
    ├─→ Repository 2 (token A) ─→ Linear Workspace 1  
    └─→ Repository 3 (token B) ─→ Linear Workspace 2
    ↓ connects to proxy (grouped by token)
Edge Proxy
    ↓ webhooks from all workspaces
Linear
```

Key features:
- Multiple repositories can share the same Linear workspace/token
- Repositories with different tokens connect separately to minimize connections
- Each repository has its own workspace directory and configuration
- OAuth tokens serve dual purpose: proxy auth and Linear API calls

## Prompt Templates

The EdgeWorker supports customizable prompt templates to tailor Claude's behavior for different repositories or workflows.

### Default Template

If no custom template is specified, EdgeWorker uses a built-in template that helps Claude determine whether to:
1. **Execute** - When requirements are clear, implement the solution
2. **Clarify** - When requirements are vague, ask clarifying questions

### Custom Templates

You can provide custom templates at two levels:
- **Global**: Via `config.features.promptTemplatePath`
- **Per-repository**: Via `repository.promptTemplatePath` (takes precedence)

### Template Variables

Templates use Handlebars-style variables that are automatically replaced:

- `{{repository_name}}` - Name of the repository
- `{{issue_id}}` - Linear issue ID
- `{{issue_title}}` - Issue title
- `{{issue_description}}` - Full issue description
- `{{issue_state}}` - Current issue state
- `{{issue_priority}}` - Priority level (0-4)
- `{{issue_url}}` - Direct link to Linear issue
- `{{comment_history}}` - All previous comments formatted
- `{{latest_comment}}` - Most recent comment text
- `{{working_directory}}` - Current working directory
- `{{base_branch}}` - Base git branch (e.g., 'main')
- `{{branch_name}}` - Issue branch name

### Example Custom Template

```markdown
You are an expert {{repository_name}} developer.

## Current Task
**Issue**: {{issue_title}} (#{{issue_id}})
**Priority**: {{issue_priority}}
**Status**: {{issue_state}}

## Description
{{issue_description}}

## Previous Discussion
{{comment_history}}

## Technical Context
- Repository: {{repository_name}}
- Working Directory: {{working_directory}}
- Branch: {{branch_name}} (from {{base_branch}})

## Instructions
1. Review the issue requirements carefully
2. Check existing code patterns in the repository
3. Implement a solution following project conventions
4. Ensure all tests pass
5. Create a descriptive pull request

Remember to ask clarifying questions if requirements are unclear.
```

### Using Custom Templates

```typescript
// Global template for all repositories
const edgeWorker = new EdgeWorker({
  // ... other config
  features: {
    promptTemplatePath: './prompts/default.md'
  }
})

// Per-repository templates
const edgeWorker = new EdgeWorker({
  repositories: [{
    id: 'frontend',
    name: 'Frontend App',
    // ... other config
    promptTemplatePath: './prompts/frontend-specific.md'
  }, {
    id: 'backend', 
    name: 'Backend API',
    // ... other config
    promptTemplatePath: './prompts/backend-specific.md'
  }]
})
```

## Label-Based Repository Routing

EdgeWorker supports routing Linear issues to specific git repositories based on their labels. This allows you to have multiple repositories handling issues from the same Linear team, with routing determined by issue labels.

### Configuration

Add `routingLabels` to any repository configuration:

```json
{
  "repositories": [
    {
      "id": "frontend-app",
      "name": "Frontend Repository",
      "routingLabels": {
        "include": ["frontend", "ui", "react"],
        "exclude": ["backend"],
        "priority": 10
      }
      // ... other config
    },
    {
      "id": "backend-api",
      "name": "Backend Repository",
      "routingLabels": {
        "include": ["backend", "api", "database"],
        "priority": 10
      }
      // ... other config
    },
    {
      "id": "infrastructure",
      "name": "Infrastructure Repository",
      "routingLabels": {
        "include": ["infrastructure", "devops", "deployment"],
        "priority": 20  // Higher priority wins when multiple repos match
      }
      // ... other config
    }
  ]
}
```

### Routing Logic

When a Linear issue is assigned, EdgeWorker routes it based on this priority order:

1. **Team Key Match** (priority: 1000) - If the issue's team key matches a repository's `teamKeys`
2. **Label-Based Routing** (priority: as configured) - If the issue's labels match a repository's `routingLabels`
3. **Workspace Fallback** (priority: -1000) - Any repository in the same Linear workspace

### Label Matching Rules

- **include**: Issue must have at least one of these labels to match
- **exclude**: Issue must not have any of these labels (takes precedence over include)
- **priority**: When multiple repositories match, the one with highest priority wins

### Example Scenarios

1. **Issue with labels ["frontend", "bug"]**:
   - Routes to `frontend-app` repository (matches "frontend" in include list)

2. **Issue with labels ["backend", "database", "urgent"]**:
   - Routes to `backend-api` repository (matches both "backend" and "database")

3. **Issue with labels ["infrastructure", "frontend"]**:
   - Routes to `infrastructure` repository (priority 20 > priority 10)

4. **Issue with labels ["frontend", "backend"]** and exclude rule:
   - Routes to `backend-api` repository (frontend-app excludes "backend" label)

5. **Issue with team key "FE"**:
   - Routes to repository with `teamKeys: ["FE"]` regardless of labels (team keys have highest priority)

### Combining with Label Prompts

You can use both `routingLabels` (for repository selection) and `labelPrompts` (for AI mode selection) together:

```json
{
  "id": "frontend-app",
  "routingLabels": {
    "include": ["frontend", "ui"]
  },
  "labelPrompts": {
    "debugger": ["bug", "error"],
    "builder": ["feature", "enhancement"],
    "scoper": ["design", "planning"]
  }
}
```

In this example:
- Issues with "frontend" or "ui" labels route to this repository
- Once routed, if the issue also has a "bug" label, it uses debugger mode
- If it has a "feature" label, it uses builder mode