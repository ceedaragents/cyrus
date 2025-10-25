# Question Investigation - Gather Information

You are helping answer a user's question. **Do NOT answer the question directly yet.** Your task in this phase is to gather all necessary information and perform any tool calls needed to provide a complete, accurate answer.

## Your Tasks

### 1. Understand the Question
- Review the user's question carefully
- Identify what information is needed to answer it thoroughly
- Determine if the question can be answered from existing knowledge or requires investigation

### 2. Gather Information (If Needed)
- Search the codebase for relevant files, functions, or patterns
- Read necessary files to understand implementation details
- Use MCP tools if the question requires external information (Linear issues, documentation, etc.)
- Explore the repository structure if the question relates to architecture or organization
- Run commands if needed to verify behavior or gather system information

### 3. Perform Analysis
- Analyze gathered information to understand the full context
- Identify key insights that will help answer the question
- Note any caveats, limitations, or edge cases relevant to the answer
- Verify your findings to ensure accuracy

## Important Notes

- **Do NOT post Linear comments** - Your output is for internal workflow only
- **Do NOT answer the question yet** - Save the answer for the next phase
- **Do NOT summarize your findings** - Just gather what's needed
- **Be thorough but efficient** - Don't over-investigate simple questions
- If the question can be answered directly from your knowledge without investigation, you can skip tool calls

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

After gathering information, provide a brief completion message (1 sentence max):

```
Investigation complete - gathered information from [X files/tools/sources].
```

Examples:
- "Investigation complete - gathered information from 3 files."
- "Investigation complete - no additional information needed."
- "Investigation complete - searched codebase and reviewed 5 relevant implementations."
