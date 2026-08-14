# Contributing to Cyrus

Cyrus connects AI coding agents to Linear, GitHub, GitLab and Slack, then manages the issue-to-pull-request workflow in isolated Git worktrees. Contributions that make those workflows more reliable, easier to operate or better documented are welcome.

You can help by reporting bugs, improving documentation, proposing features or submitting fixes.

## Before You Start

- Search the existing issues and pull requests before opening a new one.
- Open an issue for a bug or focused improvement. For larger changes, discuss the approach with the maintainers before investing significant time.
- Keep each pull request focused on one problem. Small, reviewable changes are easier to test and merge.

## Development Setup

### Prerequisites

- **Node.js** 22 or later
- **pnpm** 10 or later (this is a pnpm monorepo; do not use npm or Yarn)

### Get Started

1. Fork the repository and create a branch from `main`.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build the workspace:

   ```bash
   pnpm build
   ```

4. Run the package tests:

   ```bash
   pnpm test:packages:run
   ```

5. Start packages in development mode when you need watch processes:

   ```bash
   pnpm dev
   ```

## Repository Structure

Cyrus is a TypeScript pnpm monorepo:

```text
cyrus/
├── apps/
│   ├── cli/       # The cyrus-ai CLI
│   └── f1/        # End-to-end test-drive framework
└── packages/
    ├── core/      # Shared configuration, types and session management
    ├── edge-worker/ # Issue routing and agent orchestration
    ├── *-runner/  # Agent runtime adapters
    └── *-transport/ # Linear, GitHub, GitLab and Slack event transports
```

Package-level README files contain more detail about individual components.

## Contribution Standards

- Write TypeScript and follow the structure and naming of the surrounding code.
- Add or update tests when behavior changes. We use [Vitest](https://vitest.dev/) across the packages.
- Keep public behavior, configuration and setup documentation in sync with the code.
- Use Biome for linting and formatting. Husky and lint-staged also run checks when you commit.
- Avoid unrelated refactors in the same pull request.

Before submitting, run the checks relevant to your change. For most changes, run the full verification set:

```bash
pnpm test:packages:run
pnpm typecheck
pnpm lint
```

Use `pnpm format` to apply the repository's formatting rules.

## Pull Requests

1. Rebase or merge the latest `main` into your branch.
2. Confirm that tests, type checking and linting pass.
3. Update documentation when setup, configuration or user-visible behavior changes.
4. Add an entry under `## [Unreleased]` in `CHANGELOG.md` for user-visible changes, or `CHANGELOG.internal.md` for internal-only changes. Follow the existing format and include the related issue and pull request links when available.
5. Complete the repository's [pull request template](./.github/PULL_REQUEST_TEMPLATE.md). Explain what changed and why, link the related issue and list the verification you performed.

Maintainers may ask for changes or additional verification. Review feedback is part of the process, and we appreciate follow-up commits that keep the discussion easy to trace.

## License

By contributing, you agree that your contributions will be licensed under the project's [Apache License 2.0](./LICENSE).
