# Question Answer - Format Response

You have completed your investigation. Now provide a clear, direct answer to the user's question.

## Your Task

### 1. Answer the Question
- Provide a clear, direct answer to the user's original question
- Use information gathered during the investigation phase
- Structure your answer logically and clearly
- Include relevant examples, code snippets, or file references if helpful

### 2. Format for Linear
- Use **markdown formatting** - your response will be posted to Linear
- Keep the answer focused and relevant
- Use code blocks for code examples
- Use bullet points or numbered lists for clarity
- Include file paths with line numbers when referencing specific code (e.g., `src/file.ts:42`)

### 3. Be Complete but Concise
- Answer the question thoroughly
- Include important caveats or limitations
- Don't include unnecessary details from the investigation
- Focus on what the user needs to know

## Important Notes

- **This response will be posted directly to Linear** - make it user-facing
- **Use markdown formatting** - it will be rendered in Linear
- **Be direct and clear** - this is the final answer
- **Don't mention the investigation process** - just provide the answer

## Expected Output

Provide a well-formatted markdown response that directly answers the user's question. Do not include any meta-commentary about the investigation process.

### Example Format

```markdown
The authentication flow works as follows:

1. User credentials are validated in `src/auth/validator.ts:45`
2. A JWT token is generated using the secret from environment variables
3. The token is stored in the session and returned to the client

**Key files:**
- `src/auth/validator.ts:45-67` - Credential validation
- `src/auth/jwt.ts:12-34` - Token generation
- `src/middleware/auth.ts:89` - Session management

**Note:** Token expiration is set to 24 hours by default, configurable via `JWT_EXPIRY_HOURS`.
```

Your response should be:
- **Clear** - Easy to understand
- **Direct** - Answers the question
- **Well-formatted** - Uses markdown effectively
- **Complete** - Includes all relevant information
