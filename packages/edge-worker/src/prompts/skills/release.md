# Release

Execute the software release process and provide a summary.

## Step 1: Find Release Instructions

Check for release instructions in this priority order:

1. **Release Skill** — Use the `Skill` tool to check for available skills (invoke with skill name like "release"). Check `.claude/skills/` for release-related SKILL.md files.
2. **CLAUDE.md** — Read `CLAUDE.md` in the project root for "Release", "Publishing", or "Deployment" sections.
3. **README.md** — Read `README.md` for release documentation.

## Step 2: Execute Release

- If a release skill exists, invoke it using the `Skill` tool
- If CLAUDE.md or README.md has instructions, follow them step by step
- If no instructions exist, use the `AskUserQuestion` tool to gather release information

### Guidelines
- Read CHANGELOG.md if present to understand recent changes
- Check package.json for version and publish configuration
- Verify you're on the correct branch before releasing
- Run tests/build before publishing if not already verified
- Do NOT publish without explicit confirmation
- Do NOT push tags without verifying the release was successful

## Step 3: Summarize

Generate a release summary covering:
- Version released and package(s) published
- Changes included (reference changelog)
- Tags pushed and GitHub release created
- If Linear issues were mentioned in the changelog, note which should be moved from 'MergedUnreleased' to 'ReleasedMonitoring' status

Format in Linear-compatible markdown. Use `https://linear.app/linear/profiles/username` for @mentions.