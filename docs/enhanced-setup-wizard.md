# Enhanced Setup Wizard for Project Keys & Routing Configuration

## Problem Statement

Currently, users must manually edit `~/.cyrus/config.json` to configure routing options (`projectKeys`, `teamKeys`, `routingLabels`). This creates poor UX where advanced features are hidden and require technical JSON editing skills.

The current `setupRepositoryWizard` only prompts for:
- Repository path
- Repository name  
- Base branch

Advanced routing configuration is left to manual JSON editing, making these powerful features inaccessible to many users.

## Proposed Solution: Progressive Disclosure Approach

### Phase 1: Keep Current Basic Setup ✅
- Repository path, name, base branch (unchanged)
- Maintains simplicity for basic users
- Backward compatible with existing flows

### Phase 2: Optional Advanced Configuration ✨
- Add prompt: **"Would you like to configure issue routing? (y/N)"**
- Brief explanation of routing if user chooses yes
- Skip to current defaults if user chooses no
- Maintains simplicity while exposing advanced features

### Phase 3: Smart Routing Configuration 🧠

#### Linear API Integration
- Fetch available teams and projects from user's Linear workspace
- Provide autocomplete suggestions for each routing type
- Show current Linear workspace data for better UX

#### Routing Setup (in priority order)
1. **Labels** (highest priority): "Which labels should route issues to this repo?"
   - Example: `backend, api, infrastructure`
2. **Projects** (medium priority): "Which projects should route issues to this repo?"
   - Example: `Mobile App, API Service, Backend Infrastructure`  
3. **Teams** (lowest priority): "Which teams should route issues to this repo?"
   - Example: `CEE, BACKEND, FRONTEND`

#### Input Method
- Comma-separated values (consistent with existing parsing logic in `apps/cli/app.test.ts`)
- Show suggestions from Linear API
- Display current configuration as user builds it
- Clear feedback on routing priority hierarchy

## Implementation Plan

### 1. Add Linear API Helpers
**Location**: `apps/cli/app.ts` - `setupRepositoryWizard` method

```typescript
// New helper methods
private async fetchLinearTeams(linearClient: LinearClient): Promise<string[]>
private async fetchLinearProjects(linearClient: LinearClient): Promise<string[]>
private async fetchLinearLabels(linearClient: LinearClient): Promise<string[]>
```

### 2. Enhance setupRepositoryWizard
**Location**: `apps/cli/app.ts:211-304`

- Add optional routing configuration section after basic setup
- Parse comma-separated inputs (reuse existing parsing logic from tests)
- Show helpful prompts and suggestions from Linear API
- Display configuration summary before confirmation

### 3. Update RepositoryConfig Creation
**Location**: `apps/cli/app.ts:284-295`

- Include routing configuration in repository object
- Maintain backward compatibility with existing configs
- Ensure proper type safety with existing RepositoryConfig interface

### 4. Add Comprehensive Testing
**Location**: `apps/cli/app.test.ts`

- Test routing configuration parsing (extend existing Project Keys Parsing tests)
- Test Linear API integration with mocked responses
- Test backward compatibility with existing setups
- Test progressive disclosure flow

## Benefits

- ✅ **Maintains Simplicity**: Current simple flow unchanged for basic users
- ✅ **Exposes Advanced Features**: No more manual JSON editing required
- ✅ **Smart Suggestions**: Uses Linear API for context-aware suggestions
- ✅ **Consistent UX**: Follows existing comma-separated parsing patterns
- ✅ **Clear Feedback**: Shows configuration as it's built
- ✅ **Backward Compatible**: Works with existing setups
- ✅ **Priority Clarity**: Explains routing priority hierarchy to users

## Technical Considerations

### API Usage
- Uses existing `@linear/sdk` package already in dependencies
- Leverages existing LinearClient instances from current OAuth flow
- Minimal additional API calls during setup

### Parsing Logic
- Reuses existing comma-separated parsing logic from tests
- Handles edge cases like empty strings, trailing commas, whitespace
- Validates against Linear API responses when possible

### Error Handling
- Graceful fallback if Linear API is unavailable
- Clear error messages for invalid team/project names
- Allow manual input if API suggestions fail

## Future Enhancements

1. **Validation**: Real-time validation against Linear workspace data
2. **Templates**: Save and reuse routing configurations
3. **Migration**: Tool to migrate existing manual JSON configs through wizard
4. **GUI Integration**: Extend to Electron app when ready

## Files to Modify

- `apps/cli/app.ts` - Main implementation
- `apps/cli/app.test.ts` - Enhanced testing
- `packages/edge-worker/src/types.ts` - Type definitions (if needed)
- `README.md` - Update configuration documentation
- `CHANGELOG.md` - Document new feature

---

## Implementation Notes

This feature addresses the core UX problem of hiding advanced routing features behind manual JSON editing. By using progressive disclosure and Linear API integration, we make powerful routing capabilities accessible to all users while maintaining the simplicity that makes Cyrus easy to get started with.

The implementation leverages existing code patterns and APIs, ensuring consistency with the current codebase and minimizing the risk of introducing bugs or breaking changes.