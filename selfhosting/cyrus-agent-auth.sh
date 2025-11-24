#!/bin/bash
# Linear OAuth Authentication Helper for Cyrus Self-Hosted Mode
# This script helps you authenticate your Cyrus instance with Linear OAuth

set -e

echo "🔐 Cyrus Linear OAuth Authentication"
echo "======================================"
echo ""

# Environment variables should be set in your shell profile (e.g., .zshrc)

# Check if running in self-hosted mode
if [ "${LINEAR_DIRECT_WEBHOOKS}" != "true" ]; then
    echo "⚠️  Warning: LINEAR_DIRECT_WEBHOOKS is not set to 'true'"
    echo "   This script is for self-hosted mode only."
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Check required environment variables
MISSING_VARS=()

if [ -z "${LINEAR_CLIENT_ID}" ]; then
    MISSING_VARS+=("LINEAR_CLIENT_ID")
fi

if [ -z "${LINEAR_CLIENT_SECRET}" ]; then
    MISSING_VARS+=("LINEAR_CLIENT_SECRET")
fi

if [ -z "${CYRUS_BASE_URL}" ]; then
    MISSING_VARS+=("CYRUS_BASE_URL")
fi

# Report missing variables
if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "❌ Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "Please set these environment variables and try again."
    echo ""
    echo "Example:"
    echo "  export LINEAR_CLIENT_ID='your-client-id'"
    echo "  export LINEAR_CLIENT_SECRET='your-client-secret'"
    echo "  export CYRUS_BASE_URL='https://your-domain.com'"
    echo "  export LINEAR_DIRECT_WEBHOOKS='true'"
    echo ""
    echo "For Cloudflare Tunnel users:"
    echo "  export CYRUS_BASE_URL='https://your-tunnel-domain.com'"
    echo ""
    exit 1
fi

# Get server port (default to 3456)
SERVER_PORT="${CYRUS_SERVER_PORT:-3456}"

# Display configuration
echo "✅ Configuration:"
echo "   Client ID: ${LINEAR_CLIENT_ID:0:20}..."
echo "   Base URL: ${CYRUS_BASE_URL}"
echo "   Server Port: ${SERVER_PORT}"
echo ""

# Check if server is running by attempting to connect
echo "🔍 Checking if Cyrus server is running on port ${SERVER_PORT}..."
if ! nc -z localhost "${SERVER_PORT}" 2>/dev/null && ! curl -s "http://localhost:${SERVER_PORT}" >/dev/null 2>&1; then
    echo ""
    echo "⚠️  Server doesn't appear to be running on port ${SERVER_PORT}"
    echo ""
    echo "Please start your Cyrus server first:"
    echo "  1. Run: cyrus"
    echo "  2. Or run: node apps/cli/dist/app.js"
    echo "  3. Ensure it's listening on port ${SERVER_PORT}"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    echo "✅ Server is running"
fi

# Construct OAuth URL for agent registration
# Scopes: read (default), write (update issues), comments:create (post comments),
#         app:assignable (be assigned to issues), app:mentionable (be @mentioned)
# Note: admin scope cannot be used with actor=app
REDIRECT_URI="${CYRUS_BASE_URL}/callback"
OAUTH_URL="https://linear.app/oauth/authorize?client_id=${LINEAR_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=read,write,comments:create,app:assignable,app:mentionable&actor=app"

echo ""
echo "🚀 Opening Linear OAuth authorization in your browser..."
echo ""
echo "If the browser doesn't open automatically, visit this URL:"
echo ""
echo "${OAUTH_URL}"
echo ""
echo "📋 What happens next:"
echo "   1. You'll be prompted to authorize Cyrus in Linear"
echo "   2. Click 'Authorize' to grant access"
echo "   3. Linear will redirect to: ${REDIRECT_URI}"
echo "   4. Your browser will show a success message"
echo "   5. Tokens will be saved automatically"
echo ""
echo "⏳ Waiting for authorization..."

# Open the URL in the default browser
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "$OAUTH_URL"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$OAUTH_URL"
    elif command -v gnome-open >/dev/null 2>&1; then
        gnome-open "$OAUTH_URL"
    else
        echo "⚠️  Could not detect browser launcher. Please open the URL manually."
    fi
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows
    start "$OAUTH_URL"
else
    echo "⚠️  Unknown OS. Please open the URL manually."
fi

echo ""
echo "💡 Tips:"
echo "   - The callback URL must match exactly: ${REDIRECT_URI}"
echo "   - Make sure this matches your Linear OAuth app settings"
echo "   - If using Cloudflare Tunnel, ensure it's routing to port ${SERVER_PORT}"
echo "   - Check server logs for any errors"
echo ""
echo "✅ Done! Check your browser and server logs for the authorization result."
