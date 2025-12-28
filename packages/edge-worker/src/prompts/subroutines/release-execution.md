# Release Execution Phase

You are performing a software release. Your task is to execute the release process for this project.

## Step 1: Check for Release Instructions

Check for release instructions in this priority order:

### Priority 1: Release Skill
1. Use the `Skill` tool to check for available skills (invoke with skill name like "release")
2. Look for skills named "release", "publish", "deploy", or similar
3. Check `.claude/skills/` directory for SKILL.md files related to releasing

### Priority 2: CLAUDE.md
1. Read `CLAUDE.md` in the project root
2. Look for sections about "Release", "Publishing", "Deployment", or similar
3. Follow any documented release procedures

### Priority 3: README.md
1. Read `README.md` in the project root
2. Look for sections about "Release", "Publishing", "Deployment", or similar
3. Follow any documented release procedures

## Step 2: Execute Release

### If a release skill exists:

Invoke the release skill using the `Skill` tool:
```
skill: "release"
```

Follow the skill's instructions completely. The skill will contain project-specific release procedures including:
- Version bumping
- Changelog updates
- Package publishing order
- Git tagging
- GitHub release creation

### If CLAUDE.md or README.md has release instructions:

Follow those documented instructions step by step. These may include:
- Version bump procedures
- Changelog update requirements
- Build and test commands
- Publishing commands
- Tag and release creation

### If NO release instructions exist anywhere:

Use the `AskUserQuestion` tool to gather release information:

```
AskUserQuestion with questions:
1. "How should releases be performed for this project?"
   - Options: "npm publish", "GitHub Releases only", "Custom script", "Other"

2. "What versioning scheme does this project use?"
   - Options: "Semantic versioning (semver)", "CalVer (date-based)", "Other"
```

Based on the user's response, attempt a reasonable release workflow:
- For npm projects: Check package.json for publish config
- For monorepos: Look for workspace/lerna/nx configuration
- For other projects: Follow user guidance

## Guidelines

- **Read CHANGELOG.md** if present to understand recent changes
- **Check package.json** for version and publish configuration
- **Look for existing release scripts** in package.json or scripts/
- **Verify you're on the correct branch** before releasing
- **Run tests/build** before publishing if not already verified

## Constraints

- **Do NOT guess** release procedures without skill or user input
- **Do NOT publish** to registries without explicit confirmation
- **Do NOT push tags** without verifying the release was successful

Complete with: `Release execution complete - [what was released and where].`
