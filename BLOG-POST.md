# Cyrus: Your AI-Powered Development Partner

Cyrus is an intelligent agent system that bridges the gap between issue tracking and automated software development. By integrating Linear's issue tracking with Anthropic's Claude Code, Cyrus transforms how development teams handle routine tasks.

## How It Works

When an issue is assigned to Cyrus in Linear, the magic begins:

**Issue Detection & Routing**: Cyrus monitors your Linear workspace for assigned issues. Once detected, it analyzes the issue content to determine the appropriate response strategy.

**Isolated Workspaces**: For each issue, Cyrus creates a dedicated Git worktree. This ensures complete isolation between concurrent tasks, preventing any cross-contamination of changes.

**AI-Powered Processing**: Claude Code sessions execute the required work, whether it's implementing features, fixing bugs, or answering questions. The AI follows structured procedures tailored to each task type.

**Seamless Communication**: All progress and results are posted back to Linear as comments. You can even provide mid-implementation guidance by commenting on the issue while Cyrus is working.

## The Result

Cyrus handles the mundane so you can focus on the meaningful. From creating pull requests to running tests, it manages the full development workflow autonomously while keeping you informed every step of the way.
