#!/bin/bash

# Dynamic port selection based on Linear issue ID
# Extracts numeric ID from LINEAR_ISSUE_IDENTIFIER (e.g., PACK-293 -> 293)
ID=$(echo "$LINEAR_ISSUE_IDENTIFIER" | grep -oE '[0-9]+')
BASE=30000
SLOT=$((ID % 50))
CYRUS_SERVER_PORT=$((BASE + SLOT * 2))

# Export the dynamically selected port
export CYRUS_SERVER_PORT=$CYRUS_SERVER_PORT

echo "🚀 Cyrus setup for issue $LINEAR_ISSUE_IDENTIFIER"
echo "📡 Using port: $CYRUS_SERVER_PORT"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    touch .env
fi

# Add or update the port in .env file
if grep -q "^CYRUS_SERVER_PORT=" .env; then
    # Update existing port
    sed -i.bak "s/^CYRUS_SERVER_PORT=.*/CYRUS_SERVER_PORT=$CYRUS_SERVER_PORT/" .env
    rm .env.bak 2>/dev/null
else
    # Add new port
    echo "CYRUS_SERVER_PORT=$CYRUS_SERVER_PORT" >> .env
fi

echo "✅ Environment configured with CYRUS_SERVER_PORT=$CYRUS_SERVER_PORT"