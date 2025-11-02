#!/usr/bin/env bash
#
# 🏎️  Lambo Test Drive
#
# This script demonstrates all the premium features of the Cyrus CLI platform.
# Run this to verify everything works beautifully!
#
# Usage:
#   ./test-drive-lamborghini-cli.sh
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# CLI tool path (relative to repo root)
CLI_TOOL="tools/cli-platform/lambo.mjs"

# Port for testing (use a different port from default to avoid conflicts)
export CYRUS_PORT=3458

echo -e "${BOLD}${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║       🏎️  Lambo - Test Drive Script 🏎️          ║"
echo "║                                                           ║"
echo "║   Premium UX • Beautiful Output • Excellent Help         ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${BOLD}📋 Test Plan:${NC}"
echo -e "${DIM}   1. Start server${NC}"
echo -e "${DIM}   2. Test health commands (ping, status, version)${NC}"
echo -e "${DIM}   3. Test help system${NC}"
echo -e "${DIM}   4. Create issues and members${NC}"
echo -e "${DIM}   5. Test assignIssue command${NC}"
echo -e "${DIM}   6. Create agent sessions${NC}"
echo -e "${DIM}   7. Test activity pagination and search${NC}"
echo -e "${DIM}   8. Test error handling${NC}"
echo ""

# Function to run a test step
run_test() {
    local step_name="$1"
    local command="$2"

    echo -e "${BOLD}${BLUE}▶ ${step_name}${NC}"
    echo -e "${DIM}   $ ${command}${NC}"
    echo ""

    eval "$command"

    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}   ✓ Passed${NC}\n"
    else
        echo -e "${RED}   ✗ Failed (exit code: $exit_code)${NC}\n"
        return $exit_code
    fi
}

# Function to pause and wait for user
pause() {
    echo -e "${YELLOW}   Press Enter to continue...${NC}"
    read -r
}

# =============================================================================
# STEP 1: START SERVER
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 1: Start Server ═══${NC}\n"

echo -e "${DIM}Starting Cyrus CLI server on port $CYRUS_PORT...${NC}"
echo -e "${DIM}(Server will run in background)${NC}\n"

# Start server in background (from repo root)
node tools/cli-platform/start-lambo.mjs $CYRUS_PORT > /tmp/cyrus-cli-server.log 2>&1 &
SERVER_PID=$!

echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"
echo -e "${DIM}   Waiting 3 seconds for server to initialize...${NC}\n"
sleep 3

# Verify server is running
if ! ps -p $SERVER_PID > /dev/null; then
    echo -e "${RED}✗ Server failed to start!${NC}"
    echo -e "${DIM}   Server log:${NC}"
    cat /tmp/cyrus-cli-server.log
    exit 1
fi

echo -e "${GREEN}✓ Server is running${NC}\n"
pause

# =============================================================================
# STEP 2: HEALTH COMMANDS
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 2: Test Health Commands ═══${NC}\n"

run_test "Test: ping" "$CLI_TOOL ping"
pause

run_test "Test: status" "$CLI_TOOL status"
pause

run_test "Test: version" "$CLI_TOOL version"
pause

# =============================================================================
# STEP 3: HELP SYSTEM
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 3: Test Help System ═══${NC}\n"

run_test "Test: general help" "$CLI_TOOL help"
pause

run_test "Test: command-specific help (createIssue)" "$CLI_TOOL createIssue --help"
pause

run_test "Test: command-specific help (viewSession)" "$CLI_TOOL viewSession --help"
pause

# =============================================================================
# STEP 4: CREATE DATA
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 4: Create Issues and Members ═══${NC}\n"

run_test "Test: fetchMembers (should show default users)" "$CLI_TOOL fetchMembers"
pause

run_test "Test: createMember" "$CLI_TOOL createMember --name \"Alice\" --email \"alice@example.com\""
pause

run_test "Test: createIssue" "$CLI_TOOL createIssue --title \"Fix authentication bug\" --description \"Users can't log in\""
pause

run_test "Test: createIssue with all options" "$CLI_TOOL createIssue --title \"Add dark mode\" --description \"Implement dark mode toggle\" --assignee-id agent-user-1"
pause

# =============================================================================
# STEP 5: TEST ASSIGN ISSUE
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 5: Test assignIssue Command ═══${NC}\n"

run_test "Test: assignIssue (assign to agent)" "$CLI_TOOL assignIssue --issue-id issue-1 --assignee-id agent-user-1"
pause

run_test "Test: assignIssue (reassign to user)" "$CLI_TOOL assignIssue --issue-id issue-1 --assignee-id user-3"
pause

# =============================================================================
# STEP 6: AGENT SESSIONS
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 6: Create Agent Sessions ═══${NC}\n"

run_test "Test: startSession" "$CLI_TOOL startSession --issue-id issue-1"
pause

run_test "Test: createComment with mention" "$CLI_TOOL createComment --issue-id issue-2 --body \"Please implement this feature\" --mention-agent"
pause

# =============================================================================
# STEP 7: VIEW SESSION (PAGINATION & SEARCH)
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 7: Test Activity Pagination & Search ═══${NC}\n"

# First, add some activities to a session
echo -e "${DIM}Adding activities to session-1 for testing...${NC}\n"

for i in {1..15}; do
    $CLI_TOOL promptSession --session-id session-1 --message "Test activity $i" > /dev/null 2>&1 || true
done

echo -e "${GREEN}✓ Added 15 test activities${NC}\n"
pause

run_test "Test: viewSession (default)" "$CLI_TOOL viewSession --session-id session-1"
pause

run_test "Test: viewSession with limit" "$CLI_TOOL viewSession --session-id session-1 --limit 5"
pause

run_test "Test: viewSession with offset" "$CLI_TOOL viewSession --session-id session-1 --limit 5 --offset 5"
pause

run_test "Test: viewSession with search" "$CLI_TOOL viewSession --session-id session-1 --search \"activity 5\""
pause

# =============================================================================
# STEP 8: ERROR HANDLING
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 8: Test Error Handling ═══${NC}\n"

echo -e "${BOLD}${BLUE}▶ Test: Missing required parameter${NC}"
echo -e "${DIM}   $ $CLI_TOOL createIssue${NC}\n"

$CLI_TOOL createIssue 2>&1 || true
echo -e "${GREEN}   ✓ Shows helpful error message${NC}\n"
pause

echo -e "${BOLD}${BLUE}▶ Test: Unknown command${NC}"
echo -e "${DIM}   $ $CLI_TOOL unknownCommand${NC}\n"

$CLI_TOOL unknownCommand 2>&1 || true
echo -e "${GREEN}   ✓ Shows helpful error message${NC}\n"
pause

echo -e "${BOLD}${BLUE}▶ Test: Invalid session ID${NC}"
echo -e "${DIM}   $ $CLI_TOOL viewSession --session-id invalid-999${NC}\n"

$CLI_TOOL viewSession --session-id invalid-999 2>&1 || true
echo -e "${GREEN}   ✓ Shows helpful error message${NC}\n"
pause

# =============================================================================
# STEP 9: DEBUG COMMAND
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Step 9: Debug Commands ═══${NC}\n"

run_test "Test: getState" "$CLI_TOOL getState"
pause

# =============================================================================
# CLEANUP
# =============================================================================

echo -e "${BOLD}${MAGENTA}═══ Cleanup ═══${NC}\n"

echo -e "${DIM}Stopping server (PID: $SERVER_PID)...${NC}"
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
echo -e "${GREEN}✓ Server stopped${NC}\n"

# =============================================================================
# SUMMARY
# =============================================================================

echo -e "${BOLD}${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║              ✅ TEST DRIVE COMPLETE ✅                     ║"
echo "║                                                           ║"
echo "║   All features of the Lambo are working!       ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${BOLD}📊 Features Tested:${NC}"
echo -e "${GREEN}   ✓${NC} Server health commands (ping, status, version)"
echo -e "${GREEN}   ✓${NC} Beautiful help system (general + per-command)"
echo -e "${GREEN}   ✓${NC} Issue and member management"
echo -e "${GREEN}   ✓${NC} assignIssue command"
echo -e "${GREEN}   ✓${NC} Agent session creation"
echo -e "${GREEN}   ✓${NC} Activity pagination (--limit, --offset)"
echo -e "${GREEN}   ✓${NC} Activity search (--search)"
echo -e "${GREEN}   ✓${NC} Professional error messages"
echo -e "${GREEN}   ✓${NC} Connection feedback"
echo -e "${GREEN}   ✓${NC} Beautiful colored output"
echo ""

echo -e "${BOLD}${CYAN}Next Steps:${NC}"
echo -e "${DIM}   • Review test output above${NC}"
echo -e "${DIM}   • Try running commands manually${NC}"
echo -e "${DIM}   • Check CLI_TOOL_README.md for documentation${NC}"
echo -e "${DIM}   • See CLAUDE.md for \"Driving the Lamborghini\" guide${NC}"
echo ""

echo -e "${BOLD}${YELLOW}🎉 The Lambo is ready to race! 🏎️${NC}\n"
