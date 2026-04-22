#!/usr/bin/env bash
#
# Extract the current tool list from Claude Code's init block.
#
# Usage:
#   ./scripts/extract-claude-tools.sh
#
# This runs a minimal Claude Code session with stream-json output and
# extracts the tool names from the 'init' message. Use this whenever
# updating @anthropic-ai/claude-agent-sdk to refresh the tool allowance
# lists in packages/claude-runner/src/config.ts.

set -euo pipefail

# Resolve the cli.js bundled inside @anthropic-ai/claude-agent-sdk using Node's
# module resolution — the same logic used by ClaudeRunner.ts at runtime.
# This ensures we extract tools from the *installed SDK version*, not whatever
# system-wide `claude` binary happens to be on PATH.
CLI_PATH=$(node -e "
  const { createRequire } = require('module');
  const { dirname, join } = require('path');
  const { existsSync } = require('fs');
  // Resolve from claude-runner's package.json context since that's where the SDK is a direct dep
  const req = createRequire(require.resolve('./packages/claude-runner/package.json'));
  const sdkPath = req.resolve('@anthropic-ai/claude-agent-sdk');
  const cliPath = join(dirname(sdkPath), 'cli.js');
  if (!existsSync(cliPath)) { process.stderr.write('cli.js not found at: ' + cliPath + '\n'); process.exit(1); }
  process.stdout.write(cliPath);
" 2>/dev/null) || {
  echo "ERROR: Could not resolve @anthropic-ai/claude-agent-sdk cli.js."
  echo "Make sure dependencies are installed: pnpm install"
  exit 1
}

echo "Using SDK CLI: $CLI_PATH"
echo "Running Claude Code to capture init block..."
# Capture full output to a temp file to avoid SIGPIPE from head -1
# (pipefail + head causes claude to exit non-zero when the pipe closes early)
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT
node "$CLI_PATH" -p "say hi" --output-format stream-json --verbose 2>/dev/null > "$tmpfile" || true
init_json=$(head -1 "$tmpfile")

# The first line of stream-json output is the init message containing the tool list
tools=$(echo "$init_json" | jq -r '.tools[]' 2>/dev/null)

if [ -z "$tools" ]; then
  echo "ERROR: Could not extract tools from init block."
  echo "Raw init line:"
  echo "$init_json"
  exit 1
fi

echo ""
echo "=== Claude Code Available Tools ==="
echo "$tools" | sort
echo ""
echo "Total: $(echo "$tools" | wc -l | tr -d ' ') tools"
echo ""
echo "Compare these against packages/claude-runner/src/config.ts availableTools"
echo "and update the list if there are differences."
