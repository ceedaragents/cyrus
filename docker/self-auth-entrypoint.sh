#!/bin/sh
# Entrypoint for the self-auth Railway deployment (Dockerfile.selfauth).
#
# self-auth-linear (apps/cli/src/commands/SelfAuthCommand.ts) requires an
# existing config.json and errors out otherwise. On a brand new Railway
# volume there is no config.json yet, so seed a minimal one before handing
# off to the real auth command.
set -e

echo "DEBUG HOME=[$HOME]"
echo "DEBUG whoami=[$(whoami)]"
ls -la "$HOME" || true

mkdir -p "$HOME/.cyrus"
if [ ! -f "$HOME/.cyrus/config.json" ]; then
	printf '%s' '{"repositories":[]}' > "$HOME/.cyrus/config.json"
	echo "Seeded $HOME/.cyrus/config.json"
fi
cat "$HOME/.cyrus/config.json"

exec node dist/src/app.js self-auth-linear
