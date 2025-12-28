# Release Summary

Generate a summary of the release process for posting to Linear.

## Your Task

Create a clear summary of what was released:

### 1. Release Information
- Version released (e.g., v0.2.7)
- Package(s) published
- Registry/destination (npm, GitHub Releases, etc.)

### 2. Changes Included
- Brief summary of what's in this release
- Link to changelog or release notes if available

### 3. Post-Release Actions
- Tags pushed
- GitHub release created (with link if applicable)
- Any follow-up tasks needed

### 4. Linear Issue Updates
- If Linear issues were mentioned in the changelog, note which issues should be moved from 'MergedUnreleased' to 'ReleasedMonitoring' status

## Format Requirements

- **Be concise** - focus on what was released
- Use markdown formatting for readability
- Include version numbers and links where helpful
- **To mention someone**: Use `https://linear.app/linear/profiles/username` syntax

## Constraints

- **You have exactly 1 turn** - generate the summary in a single response
- This is the final output that will be posted to Linear
- Focus on the release outcome, not the process details

## Example Format

```
## Release Complete

**Version**: v0.2.7
**Published to**: npm (@cyrus-ai/*)

### What's Included
- Feature X improvements
- Bug fix for Y
- Performance optimizations

### Links
- [GitHub Release](https://github.com/org/repo/releases/tag/v0.2.7)
- [Changelog](./CHANGELOG.md)

### Linear Issues
The following issues can be moved to 'ReleasedMonitoring':
- CYPACK-XXX
- CYPACK-YYY
```
