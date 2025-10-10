#!/bin/bash

# Cyrus Proxy Worker - Wrangler Cleanup Script
# This script removes all KV namespaces created by the setup script

set -e  # Exit on any error

echo "🧹 Cleaning up Wrangler workspace for Cyrus Proxy Worker..."

# Check if wrangler is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx not found. Please install Node.js and npm."
    exit 1
fi

echo "📋 Checking Wrangler authentication..."
if ! npx wrangler whoami &> /dev/null; then
    echo "❌ Error: Not authenticated with Cloudflare. Please run 'npx wrangler login' first."
    exit 1
fi

echo "✅ Wrangler authentication verified."

# Get list of all namespaces
echo "🔍 Fetching current KV namespaces..."
namespaces_json=$(npx wrangler kv namespace list 2>/dev/null)

# Parse and delete namespaces that match our naming pattern
echo "🗑️  Deleting Cyrus-related namespaces..."

# Extract namespace IDs and titles
namespace_ids=$(echo "$namespaces_json" | grep -E '"id"|"title"' | paste - - | grep -E 'OAUTH_TOKENS|OAUTH_STATE|EDGE_TOKENS|WORKSPACE_METADATA' | grep -o '"id": "[^"]*"' | cut -d'"' -f4)

if [ -z "$namespace_ids" ]; then
    echo "ℹ️  No Cyrus-related namespaces found to delete."
else
    for id in $namespace_ids; do
        # Get the namespace title for confirmation
        title=$(echo "$namespaces_json" | jq -r ".[] | select(.id == \"$id\") | .title" 2>/dev/null || echo "Unknown")
        echo "Deleting namespace: $title (ID: $id)"
        
        # Delete the namespace
        if npx wrangler kv namespace delete --namespace-id "$id" 2>/dev/null; then
            echo "✅ Deleted: $title"
        else
            echo "⚠️  Failed to delete: $title (ID: $id)"
        fi
    done
fi

# Restore backup if it exists
if [ -f "wrangler.toml.backup" ]; then
    echo "📋 Restoring wrangler.toml from backup..."
    cp wrangler.toml.backup wrangler.toml
    echo "✅ Restored wrangler.toml from backup"
    
    read -p "🗑️  Remove backup file? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm wrangler.toml.backup
        echo "✅ Removed backup file"
    fi
else
    echo "⚠️  No backup file found. wrangler.toml was not modified."
fi

echo ""
echo "🎉 Cleanup complete!"
echo ""
echo "💡 To set up the workspace again, run:"
echo "   ./scripts/setup-wrangler.sh"
