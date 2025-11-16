# Lambo Test Drives

This directory contains real-world usage logs of the Lambo CLI platform, documenting the developer experience of using Cyrus to accomplish actual development goals.

## Purpose

These test drives serve as:
1. **UX research** - Identifying friction points and delights
2. **Product validation** - Testing if the system achieves its goals
3. **Documentation** - Showing realistic usage patterns
4. **Design input** - Driving future improvements

## Test Drives

### #001 - Rate Limiter Feature Development
**Date**: 2025-11-03  
**Goal**: Implement a token bucket rate limiter utility  
**Duration**: ~10 minutes  
**Outcome**: ✅ Positive experience with identified improvements  

**Key Findings**:
- **Strengths**: Beautiful output, excellent help system, engaging activity stream
- **Weaknesses**: Status indicators, activity previews, progress visibility
- **Score**: 8.5/10 UX quality, would use daily with improvements

[View full log →](./001-rate-limiter-feature.md)

---

## Common Themes Across Test Drives

*(Will be updated as more test drives are added)*

### Consistent Strengths
- Professional ANSI colored output
- Clear error messages with suggestions
- Pagination and search work smoothly

### Consistent Pain Points
- Status field doesn't reflect actual work state
- File paths truncated in activity previews
- Lack of overall progress indicators

### Most Requested Features
- Real-time tailing mode (`lambo tail --session-id X`)
- File browser to see modified files
- Activity filtering by type
- Session summaries and exports

---

## Guidelines for Future Test Drives

1. **Pick realistic goals** - Small-to-medium scope development tasks
2. **Document as you go** - Capture immediate reactions and feelings
3. **Be honest** - Note both delights and frustrations
4. **Think like a user** - Don't use insider knowledge to work around issues
5. **Time it** - Track how long each phase takes
6. **Rate it** - Provide numerical scores for comparison

---

**Next test drive ideas**:
- Bug fix workflow (find issue, diagnose, fix, test)
- Refactoring session (improve existing code structure)
- Documentation generation (create API docs from code)
- Multi-file feature (touches 5+ files across packages)

