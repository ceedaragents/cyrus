/**
 * Prompt Assembly Tests - Routing Context Generation
 *
 * Tests the routing context generation for orchestrator multi-repository scenarios.
 *
 * IMPORTANT: These tests assert the ENTIRE prompt, not partial checks with .toContain().
 * This ensures comprehensive test coverage and catches regressions in prompt structure.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Routing Context", () => {
	it("should not include routing context for single-repository setup", async () => {
		const repository = {
			id: "repo-single-123",
			name: "Single Repo",
			repositoryPath: "/test/single-repo",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-1",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/org/single-repo",
			routingLabels: ["backend"],
			teamKeys: ["BACK"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([repository]);

		const session = {
			issueId: "issue-123",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-123",
			identifier: "BACK-100",
			title: "Single repo orchestration",
			description: "Test issue",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Orchestrate this task")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Single Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-123</id>
<identifier>BACK-100</identifier>
<title>Single repo orchestration</title>
<description>Test issue</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Orchestrate this task
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should include routing context for multi-repository setup", async () => {
		const frontendRepo = {
			id: "repo-frontend-123",
			name: "Frontend App",
			repositoryPath: "/test/frontend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/myorg/frontend-app",
			routingLabels: ["frontend", "ui"],
			teamKeys: ["FE"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const backendRepo = {
			id: "repo-backend-456",
			name: "Backend API",
			repositoryPath: "/test/backend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",
			linearToken: "test-token-456",
			baseBranch: "main",
			githubUrl: "https://github.com/myorg/backend-api",
			routingLabels: ["backend", "api"],
			teamKeys: ["BE"],
			projectKeys: ["API Project"],
		};

		const worker = createTestWorker([frontendRepo, backendRepo]);

		const session = {
			issueId: "issue-456",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-456",
			identifier: "FE-200",
			title: "Cross-repo feature",
			description: "Add feature spanning frontend and backend",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(frontendRepo)
			.withUserComment("Orchestrate this cross-repo feature")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Frontend App</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-456</id>
<identifier>FE-200</identifier>
<title>Cross-repo feature</title>
<description>Add feature spanning frontend and backend</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<repository_routing_context>
<description>
This workspace can route work to multiple applicable repositories. Choose the repository that matches each sub-issue and make the repository association explicit with one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
  <repository name="Backend API">
    <github_url>https://github.com/myorg/backend-api</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=myorg/backend-api]\` to sub-issue description
    - Routing labels: "backend", "api"
    - Team keys: "BE" (create issue in this team)
    - Project keys: "API Project" (add issue to this project)
    </routing_methods>
  </repository>
  <repository name="Frontend App">
    <github_url>https://github.com/myorg/frontend-app</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=myorg/frontend-app]\` to sub-issue description
    - Routing labels: "frontend", "ui"
    - Team keys: "FE" (create issue in this team)
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<user_comment>
Orchestrate this cross-repo feature
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should exclude inactive repositories from routing context", async () => {
		const activeRepo = {
			id: "repo-active-123",
			name: "Active Repo",
			repositoryPath: "/test/active",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/org/active-repo",
			isActive: true,
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const inactiveRepo = {
			id: "repo-inactive-456",
			name: "Inactive Repo",
			repositoryPath: "/test/inactive",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",
			linearToken: "test-token-456",
			baseBranch: "main",
			githubUrl: "https://github.com/org/inactive-repo",
			isActive: false,
		};

		const worker = createTestWorker([activeRepo, inactiveRepo]);

		const session = {
			issueId: "issue-789",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-789",
			identifier: "TEST-300",
			title: "Test inactive filtering",
			description: "Should not show inactive repo",
		};

		// Only one active repo means no routing context (same as single-repo case)
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(activeRepo)
			.withUserComment("Check routing context")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Active Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-789</id>
<identifier>TEST-300</identifier>
<title>Test inactive filtering</title>
<description>Should not show inactive repo</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check routing context
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should only include repositories from the same workspace", async () => {
		const workspace1Repo = {
			id: "repo-ws1-123",
			name: "Workspace 1 Repo",
			repositoryPath: "/test/ws1",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-repo",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2Repo = {
			id: "repo-ws2-456",
			name: "Workspace 2 Repo",
			repositoryPath: "/test/ws2",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",
			linearToken: "test-token-456",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-repo",
		};

		const worker = createTestWorker([workspace1Repo, workspace2Repo]);

		const session = {
			issueId: "issue-999",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-999",
			identifier: "WS1-100",
			title: "Workspace isolation test",
			description: "Should not show other workspace repos",
		};

		// Only one repo in this workspace means no routing context
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(workspace1Repo)
			.withUserComment("Check workspace isolation")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Workspace 1 Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-999</id>
<identifier>WS1-100</identifier>
<title>Workspace isolation test</title>
<description>Should not show other workspace repos</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check workspace isolation
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("generateRoutingContextForAllWorkspaces should include routing contexts for each multi-repo workspace", () => {
		const workspace1RepoA = {
			id: "repo-ws1-a",
			name: "Workspace One App",
			repositoryPath: "/test/ws1/app",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",
			linearToken: "test-token-1",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-app",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace1RepoB = {
			id: "repo-ws1-b",
			name: "Workspace One API",
			repositoryPath: "/test/ws1/api",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",
			linearToken: "test-token-2",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-api",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2RepoA = {
			id: "repo-ws2-a",
			name: "Workspace Two Service",
			repositoryPath: "/test/ws2/service",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",
			linearToken: "test-token-3",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-service",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2RepoB = {
			id: "repo-ws2-b",
			name: "Workspace Two Worker",
			repositoryPath: "/test/ws2/worker",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",
			linearToken: "test-token-4",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-worker",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([
			workspace1RepoA,
			workspace1RepoB,
			workspace2RepoA,
			workspace2RepoB,
		]);

		const promptBuilder = (worker as any).promptBuilder as {
			generateRoutingContextForAllWorkspaces: () => string;
		};
		const context = promptBuilder.generateRoutingContextForAllWorkspaces();

		expect(context).toBe(`<repository_routing_context>
<description>
This workspace can route work to multiple applicable repositories. Choose the repository that matches each sub-issue and make the repository association explicit with one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
  <repository name="Workspace One API">
    <github_url>https://github.com/org/ws1-api</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/ws1-api]\` to sub-issue description
    </routing_methods>
  </repository>
  <repository name="Workspace One App">
    <github_url>https://github.com/org/ws1-app</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/ws1-app]\` to sub-issue description
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<repository_routing_context>
<description>
This workspace can route work to multiple applicable repositories. Choose the repository that matches each sub-issue and make the repository association explicit with one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
  <repository name="Workspace Two Service">
    <github_url>https://github.com/org/ws2-service</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/ws2-service]\` to sub-issue description
    </routing_methods>
  </repository>
  <repository name="Workspace Two Worker">
    <github_url>https://github.com/org/ws2-worker</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/ws2-worker]\` to sub-issue description
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>`);
	});

	it("should enumerate every repository in the workspace without truncation when more than two repositories apply", async () => {
		const frontendRepo = {
			id: "repo-frontend-1",
			name: "Frontend App",
			repositoryPath: "/test/frontend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-many",
			linearToken: "token-frontend",
			baseBranch: "main",
			githubUrl: "https://github.com/org/frontend-app",
			routingLabels: ["frontend", "ui"],
			teamKeys: ["FE"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const backendRepo = {
			id: "repo-backend-2",
			name: "Backend API",
			repositoryPath: "/test/backend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-many",
			linearToken: "token-backend",
			baseBranch: "main",
			githubUrl: "https://github.com/org/backend-api",
			routingLabels: ["backend", "api"],
			teamKeys: ["BE"],
		};

		const docsRepo = {
			id: "repo-docs-3",
			name: "Documentation Site",
			repositoryPath: "/test/docs",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-many",
			linearToken: "token-docs",
			baseBranch: "main",
			githubUrl: "https://github.com/org/docs-site",
			routingLabels: ["docs"],
			teamKeys: ["DOCS"],
		};

		const worker = createTestWorker([frontendRepo, backendRepo, docsRepo]);
		const session = {
			issueId: "issue-many-1",
			workspace: { path: "/test" },
			metadata: {},
		};
		const issue = {
			id: "issue-many-1",
			identifier: "FE-300",
			title: "Cross-repo platform work",
			description: "Touches frontend, backend, and docs",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(frontendRepo)
			.withUserComment("Orchestrate the platform-wide update")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Frontend App</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-many-1</id>
<identifier>FE-300</identifier>
<title>Cross-repo platform work</title>
<description>Touches frontend, backend, and docs</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<repository_routing_context>
<description>
This workspace can route work to multiple applicable repositories. Choose the repository that matches each sub-issue and make the repository association explicit with one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
  <repository name="Backend API">
    <github_url>https://github.com/org/backend-api</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/backend-api]\` to sub-issue description
    - Routing labels: "backend", "api"
    - Team keys: "BE" (create issue in this team)
    </routing_methods>
  </repository>
  <repository name="Documentation Site">
    <github_url>https://github.com/org/docs-site</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/docs-site]\` to sub-issue description
    - Routing labels: "docs"
    - Team keys: "DOCS" (create issue in this team)
    </routing_methods>
  </repository>
  <repository name="Frontend App">
    <github_url>https://github.com/org/frontend-app</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=org/frontend-app]\` to sub-issue description
    - Routing labels: "frontend", "ui"
    - Team keys: "FE" (create issue in this team)
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<user_comment>
Orchestrate the platform-wide update
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});
});
