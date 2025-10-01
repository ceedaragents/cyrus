#!/usr/bin/env bash

set -euo pipefail

show_usage() {
	echo "Usage: $(basename "$0") [--kill PID]" >&2
	echo "       $(basename "$0") --help" >&2
}

if [[ ${1:-} == "--help" ]]; then
	show_usage
	echo
	echo "Lists active Cyrus edge-worker CLI (dist/apps/cli/app.js) and ngrok processes." >&2
	echo "Use --kill to send SIGTERM to a specific PID once you've confirmed it is stale." >&2
	exit 0
fi

if [[ ${1:-} == "--kill" ]]; then
	shift || true
	if [[ $# -eq 0 ]]; then
		echo "error: expected a PID after --kill" >&2
		show_usage
		exit 1
	fi
	if [[ ! $1 =~ ^[0-9]+$ ]]; then
		echo "error: PID must be numeric" >&2
		exit 1
	fi
	pid=$1
	if ! ps -p "$pid" >/dev/null 2>&1; then
		echo "No process with PID $pid is currently running." >&2
		exit 1
	fi
	echo "Sending SIGTERM to PID $pid..."
	kill -TERM "$pid"
	echo "Done. Use 'ps -p $pid' to confirm it exited." >&2
	exit 0
fi

echo "Cyrus edge-worker / ngrok process helper"
echo "----------------------------------------"

list_matches() {
	local label=$1
	local pattern=$2
	local matches
	matches=$(pgrep -fl -f "$pattern" || true)
	if [[ -z $matches ]]; then
		echo "$label: none"
	else
		echo "$label:"
		echo "$matches" | sed 's/^/  /'
	fi
}

list_matches "Edge worker CLI" "apps/cli/dist/app.js"
list_matches "ngrok" "ngrok"

cat <<"INFO"

If a process is stale, terminate it with:
  $(basename "$0") --kill <PID>

Always use SIGTERM first so the process can clean up.
INFO
