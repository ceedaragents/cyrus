# Agent Teams Integration for Cyrus

## Design Document

### Overview

This document sketches the integration of Claude Code's native Agent Teams into Cyrus's orchestration layer. The goal is to enable parallel execution of work that is currently sequential, while preserving Cyrus's safety model, Linear integration, and lifecycle management.

### Key Principle

> Cyrus continues to own the **bridge** (Linear ↔ AI agent). Agent Teams become the **execution engine** underneath.

---

## 1. New Package: `packages/team-runner`

A new package that implements `IAgentRunner` but internally creates and manages a Claude Code Agent Team.

### 1.1 Package Structure

```
packages/team-runner/
├── src/
│   ├── index.ts
│   ├── TeamRunner.ts          # Main IAgentRunner implementation
│   ├── TeamTaskBuilder.ts     # Converts procedures → team task lists
│   ├── ComplexityScorer.ts    # Decides: single session vs team
│   ├── LinearActivityBridge.ts # Streams team events → Linear
│   └── types.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 2. Complexity Scorer — When to Use Teams

Not every task benefits from teams. A complexity scorer decides.

```typescript
// packages/team-runner/src/ComplexityScorer.ts

export interface ComplexityScore {
  score: number;          // 0-100
  useTeam: boolean;       // true if score > threshold
  reasoning: string;
  suggestedTeamSize: number;
}

export interface ComplexityInput {
  classification: RequestClassification;
  issueTitle: string;
  issueDescription: string;
  procedure: ProcedureDefinition;
  /** Optional: labels on the issue */
  labels?: string[];
}

const TEAM_THRESHOLD = 60;

export function scoreComplexity(input: ComplexityInput): ComplexityScore {
  let score = 0;
  const reasons: string[] = [];

  // Orchestrator mode always benefits from teams
  if (input.classification === "orchestrator") {
    score += 80;
    reasons.push("orchestrator classification → parallel sub-issues");
  }

  // Debugger benefits from competing hypotheses
  if (input.classification === "debugger") {
    score += 50;
    reasons.push("debugger → competing hypothesis exploration");
  }

  // Code tasks: check description length as proxy for complexity
  if (input.classification === "code") {
    const descLen = (input.issueDescription || "").length;
    if (descLen > 2000) {
      score += 40;
      reasons.push("long description suggests complex requirements");
    } else if (descLen > 800) {
      score += 20;
      reasons.push("moderate description length");
    }

    // Check for keywords suggesting multi-file work
    const complexKeywords = [
      "refactor", "migrate", "redesign", "overhaul",
      "multiple files", "across the codebase", "end-to-end",
      "frontend and backend", "full-stack",
    ];
    const desc = (input.issueDescription || "").toLowerCase();
    const matchedKeywords = complexKeywords.filter(k => desc.includes(k));
    if (matchedKeywords.length > 0) {
      score += matchedKeywords.length * 10;
      reasons.push(`complexity keywords: ${matchedKeywords.join(", ")}`);
    }
  }

  // Simple classifications never use teams
  if (["question", "documentation", "transient", "planning"].includes(input.classification)) {
    score = 0;
    reasons.push(`${input.classification} tasks don't benefit from teams`);
  }

  // Determine team size
  let suggestedTeamSize = 2;
  if (score >= 80) suggestedTeamSize = 4;
  else if (score >= 60) suggestedTeamSize = 3;

  return {
    score,
    useTeam: score >= TEAM_THRESHOLD,
    reasoning: reasons.join("; "),
    suggestedTeamSize,
  };
}
```

---

## 3. Team Task Builder — Procedures → Team Tasks

Converts Cyrus's sequential procedures into a dependency-aware task graph.

```typescript
// packages/team-runner/src/TeamTaskBuilder.ts

import type { ProcedureDefinition, SubroutineDefinition } from "cyrus-core";

export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  blockedBy: string[];
  /** Which teammate type should own this */
  assignTo?: "researcher" | "implementer" | "verifier" | "git-handler" | "summarizer";
  /** Subroutine metadata for the Linear activity bridge */
  subroutine: SubroutineDefinition;
}

/**
 * Convert a full-development procedure into parallelizable team tasks.
 *
 * Current sequential flow:
 *   coding-activity → verifications → changelog-update → git-commit → gh-pr → concise-summary
 *
 * Team flow with parallelization:
 *   research (new)  ─┐
 *                     ├─→ implement ─→ verify  ─┐
 *   plan (new)      ─┘                          ├─→ git-commit → gh-pr → summary
 *                                changelog-update ─┘
 */
export function buildFullDevelopmentTasks(
  procedure: ProcedureDefinition,
  issueContext: string,
): TeamTask[] {
  return [
    {
      id: "1",
      subject: "Research codebase context",
      description: `Read and understand the codebase relevant to this task.
Identify: existing patterns, related files, test structures, dependencies.
Issue context:\n${issueContext}`,
      activeForm: "Researching codebase",
      blockedBy: [],
      assignTo: "researcher",
      subroutine: { name: "research", promptPath: "", description: "Codebase research" },
    },
    {
      id: "2",
      subject: "Implement changes",
      description: `Implement the requested changes based on research findings.
Follow existing patterns. Write clean, tested code.
Issue context:\n${issueContext}`,
      activeForm: "Implementing changes",
      blockedBy: ["1"], // Wait for research
      assignTo: "implementer",
      subroutine: procedure.subroutines.find(s => s.name === "coding-activity")!,
    },
    {
      id: "3",
      subject: "Run verifications (tests, lint, typecheck)",
      description: "Run the full verification suite: tests, linting, type checking. Report pass/fail with details.",
      activeForm: "Running verifications",
      blockedBy: ["2"], // Wait for implementation
      assignTo: "verifier",
      subroutine: procedure.subroutines.find(s => s.name === "verifications")!,
    },
    {
      id: "4",
      subject: "Update changelog",
      description: "Update CHANGELOG.md with the changes made. Follow existing changelog format.",
      activeForm: "Updating changelog",
      blockedBy: ["2"], // Can run in parallel with verifications
      assignTo: "implementer",
      subroutine: procedure.subroutines.find(s => s.name === "changelog-update")!,
    },
    {
      id: "5",
      subject: "Commit and push changes",
      description: "Stage all changes, create a descriptive commit, and push to remote.",
      activeForm: "Committing and pushing",
      blockedBy: ["3", "4"], // Wait for both verification AND changelog
      assignTo: "git-handler",
      subroutine: procedure.subroutines.find(s => s.name === "git-commit")!,
    },
    {
      id: "6",
      subject: "Create or update Pull Request",
      description: "Create a GitHub PR with proper description, linked to the Linear issue.",
      activeForm: "Creating pull request",
      blockedBy: ["5"],
      assignTo: "git-handler",
      subroutine: procedure.subroutines.find(s => s.name === "gh-pr")!,
    },
    {
      id: "7",
      subject: "Generate summary for Linear",
      description: "Write a concise summary of what was done, for posting back to Linear.",
      activeForm: "Generating summary",
      blockedBy: ["6"],
      assignTo: "summarizer",
      subroutine: procedure.subroutines.find(s => s.name === "concise-summary")!,
    },
  ];
}

/**
 * Convert an orchestrator procedure into parallel sub-issue tasks.
 * This is dynamically generated based on the decomposition the lead performs.
 */
export function buildOrchestratorTasks(
  subIssues: Array<{ id: string; title: string; description: string; dependsOn?: string[] }>,
): TeamTask[] {
  const tasks: TeamTask[] = [];

  for (const [index, subIssue] of subIssues.entries()) {
    const taskId = String(index + 1);

    // Implementation task
    tasks.push({
      id: `impl-${taskId}`,
      subject: `Implement: ${subIssue.title}`,
      description: subIssue.description,
      activeForm: `Implementing ${subIssue.title}`,
      blockedBy: (subIssue.dependsOn || []).map(dep => `verify-${dep}`),
      assignTo: "implementer",
      subroutine: { name: "sub-issue-impl", promptPath: "", description: subIssue.title },
    });

    // Verification task (blocked by its implementation)
    tasks.push({
      id: `verify-${taskId}`,
      subject: `Verify: ${subIssue.title}`,
      description: `Run verifications for the implementation of "${subIssue.title}"`,
      activeForm: `Verifying ${subIssue.title}`,
      blockedBy: [`impl-${taskId}`],
      assignTo: "verifier",
      subroutine: { name: "sub-issue-verify", promptPath: "", description: `Verify ${subIssue.title}` },
    });
  }

  return tasks;
}

/**
 * Convert a debugger procedure into competing hypothesis tasks.
 */
export function buildDebuggerTasks(
  issueContext: string,
): TeamTask[] {
  return [
    {
      id: "1",
      subject: "Hypothesis A: Investigate most likely root cause",
      description: `Investigate the most obvious potential cause of this bug.\n${issueContext}`,
      activeForm: "Testing hypothesis A",
      blockedBy: [],
      assignTo: "researcher",
      subroutine: { name: "hypothesis-a", promptPath: "", description: "Primary hypothesis" },
    },
    {
      id: "2",
      subject: "Hypothesis B: Investigate alternative root cause",
      description: `Investigate an alternative/less obvious cause of this bug.\n${issueContext}`,
      activeForm: "Testing hypothesis B",
      blockedBy: [],
      assignTo: "researcher",
      subroutine: { name: "hypothesis-b", promptPath: "", description: "Alternative hypothesis" },
    },
    {
      id: "3",
      subject: "Search git history for related changes",
      description: `Search git log and blame for recent changes related to this bug.\n${issueContext}`,
      activeForm: "Searching git history",
      blockedBy: [],
      assignTo: "researcher",
      subroutine: { name: "git-history", promptPath: "", description: "Git history analysis" },
    },
    {
      id: "4",
      subject: "Synthesize findings and implement fix",
      description: "Based on all hypothesis results, implement the fix for the confirmed root cause.",
      activeForm: "Implementing fix",
      blockedBy: ["1", "2", "3"], // Wait for all hypotheses
      assignTo: "implementer",
      subroutine: { name: "debugger-fix", promptPath: "", description: "Implement fix" },
    },
    {
      id: "5",
      subject: "Run verifications",
      description: "Run full test/lint/typecheck suite to validate the fix.",
      activeForm: "Running verifications",
      blockedBy: ["4"],
      assignTo: "verifier",
      subroutine: { name: "verifications", promptPath: "", description: "Verify fix" },
    },
    {
      id: "6",
      subject: "Commit, push, and create PR",
      description: "Create commit, push, and open PR.",
      activeForm: "Creating PR",
      blockedBy: ["5"],
      assignTo: "git-handler",
      subroutine: { name: "git-gh", promptPath: "", description: "Git and PR" },
    },
    {
      id: "7",
      subject: "Generate summary",
      description: "Summarize the debugging process and fix.",
      activeForm: "Generating summary",
      blockedBy: ["6"],
      assignTo: "summarizer",
      subroutine: { name: "concise-summary", promptPath: "", description: "Summary" },
    },
  ];
}
```

---

## 4. TeamRunner — The Core Integration

This is the main class that implements `IAgentRunner` using Claude Code Agent Teams under the hood.

```typescript
// packages/team-runner/src/TeamRunner.ts

import { EventEmitter } from "node:events";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentRunnerConfig,
  AgentSessionInfo,
  IAgentRunner,
  IMessageFormatter,
} from "cyrus-core";
import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import type { TeamTask } from "./TeamTaskBuilder.js";
import type { LinearActivityBridge } from "./LinearActivityBridge.js";

export interface TeamRunnerConfig extends AgentRunnerConfig {
  /** Pre-built task list for the team */
  tasks: TeamTask[];
  /** Number of teammates to spawn */
  teamSize: number;
  /** Bridge for streaming team events back to Linear */
  activityBridge?: LinearActivityBridge;
  /** Classification that triggered this team */
  classification: string;
}

/**
 * TeamRunner implements IAgentRunner by creating a Claude Code Agent Team.
 *
 * The "session" is the team lead. The lead:
 * 1. Creates the team
 * 2. Creates tasks from the pre-built task list
 * 3. Spawns teammates with appropriate roles
 * 4. Coordinates work via the shared task list
 * 5. Reports progress back via the activity bridge
 *
 * KEY DESIGN DECISION: The team lead is spawned as a single `query()` call
 * (same as ClaudeRunner), but its system prompt instructs it to create a team.
 * This means Cyrus doesn't need new SDK APIs — it uses the existing `query()`
 * with a carefully crafted prompt that makes the lead set up the team.
 */
export class TeamRunner extends EventEmitter implements IAgentRunner {
  readonly supportsStreamingInput = true;

  private config: TeamRunnerConfig;
  private abortController: AbortController | null = null;
  private sessionInfo: AgentSessionInfo | null = null;
  private messages: SDKMessage[] = [];
  private formatter: IMessageFormatter;

  constructor(config: TeamRunnerConfig) {
    super();
    this.config = config;
    this.formatter = new ClaudeMessageFormatter();

    if (config.onMessage) this.on("message", config.onMessage);
    if (config.onError) this.on("error", config.onError);
    if (config.onComplete) this.on("complete", config.onComplete);
  }

  async start(prompt: string): Promise<AgentSessionInfo> {
    if (this.isRunning()) {
      throw new Error("Team session already running");
    }

    this.sessionInfo = {
      sessionId: null,
      startedAt: new Date(),
      isRunning: true,
    };

    this.abortController = new AbortController();
    this.messages = [];

    // Build the team lead prompt that instructs it to set up the team
    const teamLeadPrompt = this.buildTeamLeadPrompt(prompt);

    try {
      const queryOptions = {
        prompt: teamLeadPrompt,
        options: {
          model: this.config.model || "opus",
          fallbackModel: this.config.fallbackModel || "sonnet",
          abortController: this.abortController,
          systemPrompt: {
            type: "preset" as const,
            preset: "claude_code" as const,
            ...(this.config.appendSystemPrompt && {
              append: this.config.appendSystemPrompt,
            }),
          },
          settingSources: ["user" as const, "project" as const, "local" as const],
          ...(this.config.workingDirectory && { cwd: this.config.workingDirectory }),
          ...(this.config.allowedTools && { allowedTools: this.config.allowedTools }),
          ...(this.config.disallowedTools && { disallowedTools: this.config.disallowedTools }),
          ...(this.config.hooks && { hooks: this.config.hooks }),
          // Enable experimental agent teams
          env: {
            CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
          },
        },
      };

      for await (const message of query(queryOptions)) {
        if (!this.sessionInfo?.isRunning) break;

        if (!this.sessionInfo.sessionId && message.session_id) {
          this.sessionInfo.sessionId = message.session_id;
        }

        this.messages.push(message);

        // Forward to activity bridge for Linear streaming
        if (this.config.activityBridge) {
          this.config.activityBridge.onMessage(message);
        }

        if (message.type === "result") {
          // Defer result emission
        } else {
          this.emit("message", message);
        }
      }

      this.sessionInfo.isRunning = false;
      this.emit("complete", this.messages);
    } catch (error) {
      if (this.sessionInfo) this.sessionInfo.isRunning = false;

      const isAbort = error instanceof Error && error.name === "AbortError";
      if (!isAbort) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.abortController = null;
    }

    return this.sessionInfo;
  }

  // startStreaming, addStreamMessage, completeStream — delegate similarly to ClaudeRunner

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.sessionInfo) {
      this.sessionInfo.isRunning = false;
    }
  }

  isRunning(): boolean {
    return this.sessionInfo?.isRunning ?? false;
  }

  getMessages(): SDKMessage[] {
    return [...this.messages];
  }

  getFormatter(): IMessageFormatter {
    return this.formatter;
  }

  /**
   * Build the team lead prompt.
   *
   * This is the critical piece: we instruct the lead to create a team,
   * set up the task list with dependencies, spawn teammates, and coordinate.
   */
  private buildTeamLeadPrompt(originalPrompt: string): string {
    const taskListStr = this.config.tasks
      .map(t => {
        const deps = t.blockedBy.length > 0
          ? `(blocked by: ${t.blockedBy.join(", ")})`
          : "(no dependencies)";
        return `- Task ${t.id}: ${t.subject} ${deps}\n  Description: ${t.description}`;
      })
      .join("\n\n");

    return `You are a team lead for a software development task. You MUST create an agent team to execute this work in parallel.

## Your Task

${originalPrompt}

## Team Setup Instructions

1. Create a team named "cyrus-${Date.now()}"
2. Create the following tasks (IMPORTANT: set blockedBy dependencies exactly as specified):

${taskListStr}

3. Spawn ${this.config.teamSize} teammates:
   - Use "sonnet" model for all teammates
   - Give each teammate a descriptive name matching their role
   - Include the full task context in their spawn prompts

4. Coordinate:
   - Assign tasks to appropriate teammates
   - Monitor progress via the task list
   - When teammates report findings (research, hypotheses), share relevant results with dependent teammates
   - If verification fails, create a fix task and reassign

5. When all tasks are complete:
   - Shut down all teammates
   - Clean up the team
   - Report the final result

## Critical Rules

- Do NOT implement tasks yourself — delegate everything to teammates
- Use delegate mode (Shift+Tab) to prevent yourself from coding
- Wait for teammates to finish before proceeding to dependent tasks
- If a teammate fails, spawn a replacement
- Share research findings between teammates via messages`;
  }
}
```

---

## 5. EdgeWorker Integration — The Decision Point

The key integration is in the EdgeWorker where it creates runners. Currently it always creates `ClaudeRunner` or `GeminiRunner`. We add a third option: `TeamRunner`.

```typescript
// In packages/edge-worker/src/EdgeWorker.ts
// Modified createRunnerForSession method (conceptual diff)

import { TeamRunner, type TeamRunnerConfig } from "cyrus-team-runner";
import { scoreComplexity } from "cyrus-team-runner";
import { buildFullDevelopmentTasks, buildDebuggerTasks } from "cyrus-team-runner";

// In the method that creates a runner after classification:

private createRunnerForProcedure(
  classification: RequestClassification,
  procedure: ProcedureDefinition,
  repository: RepositoryConfig,
  issue: IssueMinimal,
  workspace: Workspace,
  runnerConfig: AgentRunnerConfig,
): IAgentRunner {

  // Check if this task warrants a team
  const complexityResult = scoreComplexity({
    classification,
    issueTitle: issue.title || "",
    issueDescription: issue.description || "",
    procedure,
    labels: [], // could pass issue labels here
  });

  console.log(
    `[EdgeWorker] Complexity score: ${complexityResult.score} (threshold: 60), ` +
    `useTeam: ${complexityResult.useTeam}, reasoning: ${complexityResult.reasoning}`
  );

  // Check if teams are enabled for this repository
  const teamsEnabled = repository.enableAgentTeams ?? false;

  if (complexityResult.useTeam && teamsEnabled) {
    // Build the appropriate task list based on classification
    const issueContext = `Title: ${issue.title}\nDescription: ${issue.description || ""}`;
    let tasks;

    switch (classification) {
      case "orchestrator":
        // For orchestrator, the lead will dynamically create sub-issue tasks
        // We start with a minimal task list; the lead builds it
        tasks = [{
          id: "1",
          subject: "Analyze and decompose into sub-issues",
          description: `Analyze the issue and break it into parallel sub-issues.\n${issueContext}`,
          activeForm: "Decomposing issue",
          blockedBy: [],
          subroutine: { name: "orchestrator", promptPath: "", description: "Orchestration" },
        }];
        break;

      case "debugger":
        tasks = buildDebuggerTasks(issueContext);
        break;

      case "code":
      default:
        tasks = buildFullDevelopmentTasks(procedure, issueContext);
        break;
    }

    return new TeamRunner({
      ...runnerConfig,
      tasks,
      teamSize: complexityResult.suggestedTeamSize,
      classification,
    } as TeamRunnerConfig);
  }

  // Default: single session (existing behavior)
  return new ClaudeRunner(runnerConfig);
}
```

---

## 6. Linear Activity Bridge

Streams team events back to Linear so users see progress in real-time.

```typescript
// packages/team-runner/src/LinearActivityBridge.ts

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { IIssueTrackerService } from "cyrus-core";

export interface LinearActivityBridgeConfig {
  issueTracker: IIssueTrackerService;
  linearSessionId: string;
}

/**
 * Bridges Claude Code Agent Team events to Linear agent activities.
 *
 * Intercepts SDK messages from the team lead session and translates
 * them into Linear-compatible agent activities (thoughts, actions, responses).
 */
export class LinearActivityBridge {
  private config: LinearActivityBridgeConfig;
  private lastPostedAt = 0;
  private readonly MIN_POST_INTERVAL_MS = 2000; // Don't spam Linear

  constructor(config: LinearActivityBridgeConfig) {
    this.config = config;
  }

  async onMessage(message: SDKMessage): Promise<void> {
    // Rate limit posts to Linear
    const now = Date.now();
    if (now - this.lastPostedAt < this.MIN_POST_INTERVAL_MS) return;

    try {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            // Filter for team-relevant messages (teammate status, task updates)
            if (this.isTeamProgressMessage(block.text)) {
              await this.config.issueTracker.createAgentActivity(
                this.config.linearSessionId,
                {
                  type: "thought",
                  body: this.formatTeamProgress(block.text),
                  ephemeral: true,
                },
              );
              this.lastPostedAt = now;
            }
          }

          // Tool use: track team operations
          if (block.type === "tool_use") {
            const toolName = (block as any).name;
            if (this.isTeamTool(toolName)) {
              await this.config.issueTracker.createAgentActivity(
                this.config.linearSessionId,
                {
                  type: "action",
                  body: this.formatTeamAction(toolName, (block as any).input),
                  ephemeral: true,
                },
              );
              this.lastPostedAt = now;
            }
          }
        }
      }

      if (message.type === "result") {
        await this.config.issueTracker.createAgentActivity(
          this.config.linearSessionId,
          {
            type: "response",
            body: "Team execution completed.",
            ephemeral: false,
          },
        );
      }
    } catch (error) {
      console.error("[LinearActivityBridge] Failed to post activity:", error);
    }
  }

  private isTeamProgressMessage(text: string): boolean {
    const teamKeywords = [
      "teammate", "task", "completed", "spawning", "assigned",
      "blocked", "unblocked", "all tasks", "shutting down",
    ];
    const lower = text.toLowerCase();
    return teamKeywords.some(k => lower.includes(k));
  }

  private isTeamTool(toolName: string): boolean {
    return [
      "TeamCreate", "TaskCreate", "TaskUpdate", "TaskList",
      "SendMessage", "Task", // subagent spawning
    ].includes(toolName);
  }

  private formatTeamProgress(text: string): string {
    // Truncate very long messages
    if (text.length > 500) return text.substring(0, 497) + "...";
    return text;
  }

  private formatTeamAction(toolName: string, input: any): string {
    switch (toolName) {
      case "TaskCreate":
        return `📋 Created task: ${input?.subject || "unknown"}`;
      case "TaskUpdate":
        return `✅ Task ${input?.taskId} → ${input?.status || "updated"}`;
      case "SendMessage":
        return `💬 Message to ${input?.recipient || "teammate"}: ${(input?.summary || "").substring(0, 100)}`;
      case "Task":
        return `🚀 Spawned teammate: ${input?.name || input?.description || "agent"}`;
      default:
        return `🔧 ${toolName}`;
    }
  }
}
```

---

## 7. Configuration Changes

Add team-related config options to `RepositoryConfig`:

```typescript
// Added to packages/core/src/config-schemas.ts (conceptual)

// In RepositoryConfigSchema, add:
enableAgentTeams: z.boolean().optional().default(false),
teamConfig: z.object({
  /** Complexity threshold (0-100) above which teams are used */
  complexityThreshold: z.number().min(0).max(100).optional().default(60),
  /** Maximum number of teammates */
  maxTeamSize: z.number().min(2).max(6).optional().default(4),
  /** Model for teammates (default: sonnet) */
  teammateModel: z.string().optional().default("sonnet"),
  /** Model for team lead (default: opus) */
  leadModel: z.string().optional().default("opus"),
  /** Classifications that can use teams */
  enabledClassifications: z.array(z.string()).optional().default(["orchestrator", "debugger", "code"]),
}).optional(),
```

Example `config.json`:
```json
{
  "repositories": [
    {
      "id": "my-repo",
      "name": "My Repo",
      "repositoryPath": "~/code/my-repo",
      "baseBranch": "main",
      "enableAgentTeams": true,
      "teamConfig": {
        "complexityThreshold": 60,
        "maxTeamSize": 4,
        "teammateModel": "sonnet",
        "leadModel": "opus",
        "enabledClassifications": ["orchestrator", "debugger", "code"]
      }
    }
  ]
}
```

---

## 8. Architecture Diagram

```
                    Linear Webhook
                         │
                         ▼
                    ┌──────────┐
                    │EdgeWorker│  (unchanged: routing, safety, access control)
                    └────┬─────┘
                         │
                    ┌────▼──────────────┐
                    │ProcedureAnalyzer   │  (classifies issue)
                    └────┬──────────────┘
                         │
                    ┌────▼──────────────┐
                    │ComplexityScorer    │  (NEW: decides single vs team)
                    └────┬──────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      ┌───────────────┐    ┌───────────────┐
      │ ClaudeRunner  │    │  TeamRunner   │  (NEW)
      │ (single       │    │  (agent team) │
      │  session)     │    │               │
      └───────────────┘    └───┬───────────┘
                               │
                     ┌─────────┼─────────┐
                     ▼         ▼         ▼
               ┌──────┐ ┌──────┐ ┌──────┐
               │Lead  │ │Mate1 │ │Mate2 │  (Claude Code sessions)
               │(opus)│ │(son.)│ │(son.)│
               └──────┘ └──────┘ └──────┘
                     │         │         │
                     └─────────┼─────────┘
                               │
                    ┌──────────▼──────────┐
                    │LinearActivityBridge │  (NEW: streams to Linear)
                    └─────────────────────┘
```

---

## 9. What Stays the Same

These Cyrus components are **completely unchanged**:

1. **UserAccessControl** — access check before any runner is created
2. **GitService** — worktree creation per issue (teams work INSIDE the worktree)
3. **RepositoryRouter** — issue-to-repo routing
4. **PersistenceManager** — state persistence
5. **Webhook handling** — all webhook ingestion/routing
6. **AgentSessionManager** — session tracking, Linear activity posting
7. **Mid-implementation prompting** — StreamingPrompt still works (lead receives the messages)
8. **Kill switch** — unassignment stops the runner (TeamRunner.stop() aborts the lead, which kills the team)

---

## 10. Migration Path

### Phase 1: Add the infrastructure (no behavior change)
- Create `packages/team-runner` with `TeamRunner`, `ComplexityScorer`, `TeamTaskBuilder`
- Add `enableAgentTeams` config option (defaults to `false`)
- All existing behavior unchanged

### Phase 2: Enable for orchestrator mode only
- Set `enableAgentTeams: true` for test repositories
- Set `enabledClassifications: ["orchestrator"]`
- Orchestrator mode uses parallel sub-issue execution
- Monitor token usage and wall-clock time

### Phase 3: Enable for debugging
- Add `"debugger"` to `enabledClassifications`
- Competing hypothesis pattern for bug investigations

### Phase 4: Enable for complex code tasks
- Add `"code"` to `enabledClassifications`
- Only triggers for issues scoring above complexity threshold
- Research + Implementation parallelization

### Phase 5: Production hardening
- Add token budget tracking per team session
- Add circuit breaker for runaway costs
- Add team execution metrics to Linear activities
- Tune complexity threshold based on real-world data

---

## 11. Key Tradeoffs

| Aspect | Single Session | Agent Team |
|--------|---------------|------------|
| **Token cost** | 1x | 3-4x |
| **Wall-clock time** | 1x | 0.4-0.6x (orchestrator), 0.6-0.8x (code) |
| **File conflict risk** | None | Possible if teammates edit same files |
| **Context quality** | Full context in one window | Fragmented across teammates |
| **Debugging** | Easy (one session log) | Harder (multiple session logs) |
| **Reliability** | Proven | Experimental (known limitations) |

### Mitigation for file conflicts
The team lead prompt explicitly instructs file ownership partitioning:
- Research teammate: read-only
- Implementer: owns source files
- Verifier: read-only + bash (test execution)
- Git handler: owns git operations
- Summarizer: no tools (text only)

This maps cleanly to Cyrus's existing tool restriction presets:
- `readOnlyTools` for researcher/summarizer
- `safeTools` for implementer
- `coordinatorTools` for verifier (Bash for tests, no Edit)
- `safeTools` for git handler
