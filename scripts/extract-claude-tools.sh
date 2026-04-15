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

echo "Running Claude Code to capture init block..."
init_json=$(claude -p "say hi" --output-format stream-json --verbose 2>&1 | head -1)

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
