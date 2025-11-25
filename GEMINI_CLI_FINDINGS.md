# Gemini CLI maxSessionTurns Investigation

## Summary

After comprehensive investigation of the Gemini CLI source code and schema, we discovered that **`maxSessionTurns` cannot be configured per-alias**. Our entire approach was based on a misunderstanding of the Gemini CLI configuration schema.

## Key Findings

### 1. Schema Structure (from `schemas/settings.schema.json`)

**CORRECT Structure:**
```json
{
  "model": {
    "maxSessionTurns": {
      "description": "Maximum number of user/model/tool turns to keep in a session. -1 means unlimited.",
      "default": -1,
      "type": "number"
    }
  },
  "modelConfigs": {
    "aliases": {
      "my-alias": {
        "extends": "base",
        "modelConfig": {
          "model": "gemini-2.5-flash",
          "generateContentConfig": {
            "temperature": 0.5,
            "topP": 1
          }
        }
      }
    }
  }
}
```

**What We Tried (INVALID):**
```json
{
  "modelConfigs": {
    "aliases": {
      "gemini-2.5-flash-shortone": {
        "modelConfig": {
          "model": "gemini-2.5-flash",
          "maxSessionTurns": 1  ❌ NOT VALID PER SCHEMA
        }
      }
    }
  }
}
```

### 2. What Aliases Can Configure

According to the schema and `defaultModelConfigs.ts`, aliases support:

**Valid alias configurations:**
- `extends` - Inherit from parent alias
- `modelConfig.model` - Base model name
- `modelConfig.generateContentConfig`:
  - `temperature` (number)
  - `topP` (number)
  - `topK` (number)
  - `maxOutputTokens` (number)
  - `thinkingConfig` (object with budget/level)
  - `tools` (array of tool configurations)

**NOT supported in aliases:**
- ❌ `maxSessionTurns` - This is a TOP-LEVEL setting only
- ❌ Any other session-level settings

### 3. Where maxSessionTurns Lives

```json
{
  "model": {
    "maxSessionTurns": 1  ✅ ONLY VALID LOCATION
  }
}
```

This is a **GLOBAL setting** that affects ALL models and aliases.

### 4. Why Our Aliases Failed

When we passed `--model gemini-3-pro-preview-shortone`:

1. ✅ Gemini CLI correctly loaded the alias
2. ✅ It resolved `modelConfig.model` to `gemini-3-pro-preview`
3. ❌ It ignored our invalid `maxSessionTurns` field (not in schema)
4. ❌ It passed the resolved model name to Google's API
5. ❌ But the API was called with the ALIAS name, not the base model
6. ❌ Result: 404 error "models/gemini-3-pro-preview-shortone is not found"

The fundamental issue is that **Gemini CLI v0.17.0 doesn't resolve aliases properly** - it passes the alias name to the API instead of the resolved model name.

## CLI Argument Investigation

**No CLI argument exists for maxSessionTurns:**
```bash
gemini --help 2>&1 | grep -i "max"
# Returns nothing - no max-related options
```

The ONLY way to set maxSessionTurns is in `settings.json` at the top level, and it affects ALL sessions globally.

## Source Code References

### Key Files Examined

1. **`packages/core/src/config/config.ts`** (9.8k tokens)
   - Main Config class
   - Stores `this.maxSessionTurns = params.maxSessionTurns ?? -1;`
   - It's a class property, not part of model resolution

2. **`packages/core/src/services/modelConfigService.ts`** (1700 tokens)
   - Handles alias resolution via `resolveAlias()`
   - Deep merges `modelConfig.generateContentConfig`
   - Does NOT handle maxSessionTurns (not in its scope)

3. **`packages/core/src/config/models.ts`** (700 tokens)
   - Maps user aliases like 'flash' → 'gemini-2.5-flash'
   - Does NOT involve maxSessionTurns

4. **`schemas/settings.schema.json`**
   - Official JSON schema defining structure
   - `maxSessionTurns` under `model` (top-level)
   - Aliases under `modelConfigs.aliases` (different section)

5. **`packages/core/src/config/defaultModelConfigs.ts`** (900 tokens)
   - 18 predefined aliases
   - All use `generateContentConfig` only
   - NONE use maxSessionTurns

### Documentation Quote

From Gemini CLI configuration docs:

> **`model.maxSessionTurns`** (number): "Maximum number of user/model/tool turns to keep in a session. -1 means unlimited." Default: `-1`

It's explicitly documented as `model.maxSessionTurns`, confirming it's a top-level setting.

## Implications for GeminiRunner

### Current Approach (Invalid)
- ❌ Generate `-shortone` aliases with per-alias `maxSessionTurns`
- ❌ Pass `--model gemini-2.5-flash-shortone`
- ❌ Expect alias to resolve and enforce turn limit

### Alternative Approaches

#### Option 1: Global maxSessionTurns + Config Switching
```typescript
// For single-turn mode: Create temporary settings.json with maxSessionTurns: 1
const tempSettings = {
  model: { maxSessionTurns: 1 },
  general: { previewFeatures: true }
};
// Write to ~/.gemini/settings.json
// Run gemini --model gemini-2.5-flash
// Restore original settings.json
```
**Pros:** Works within schema
**Cons:** Requires file manipulation, race conditions with concurrent runs

#### Option 2: Abandon Gemini CLI Approach
```typescript
// Use Google Generative AI SDK directly
import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: { /* ... */ }
});
// Manually implement turn limiting in our code
```
**Pros:** Full control, proper turn limiting
**Cons:** More implementation work, need to replace CLI entirely

#### Option 3: Implement Turn Limiting in GeminiRunner
```typescript
// Don't rely on Gemini CLI for turn limiting
// Track turns ourselves and stop session when limit reached
private turnCount = 0;
if (this.config.singleTurn && this.turnCount >= 1) {
  this.completeStream();
  return;
}
```
**Pros:** Simple, works with current architecture
**Cons:** Gemini CLI may continue processing, wasted API calls

## Conclusion

**The `-shortone` alias approach is fundamentally incompatible with Gemini CLI's design.**

We have three realistic options:

1. **Accept multi-turn for Gemini** - Remove singleTurn support for Gemini provider
2. **Manual turn limiting** - Track turns in GeminiRunner and stop early
3. **Switch to SDK** - Replace Gemini CLI with direct SDK integration

Connor needs to decide which approach to take for CYPACK-415.

---

**Investigation References:**
- Gemini CLI Repository: https://github.com/google-gemini/gemini-cli
- Settings Schema: https://github.com/google-gemini/gemini-cli/blob/main/schemas/settings.schema.json
- Default Configs: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/defaultModelConfigs.ts
- Model Config Service: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/modelConfigService.ts
