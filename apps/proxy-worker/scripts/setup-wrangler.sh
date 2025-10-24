#!/bin/bash

# Cyrus Proxy Worker - Wrangler Setup Script
# This script automatically creates KV namespaces and configures wrangler.toml

set -e  # Exit on any error

echo "🚀 Setting up Wrangler workspace for Cyrus Proxy Worker..."

# Check if we're in the right directory
if [ ! -f "wrangler.toml.template" ]; then
    echo "❌ Error: wrangler.toml.template not found. Please run this script from the proxy-worker directory."
    exit 1
fi

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

echo "🗂️  Checking and creating KV namespaces..."

# Function to extract existing namespace IDs from wrangler.toml
get_existing_namespace_id() {
    local binding="$1"
    local type="$2"  # "id" or "preview_id"
    
    if [ -f "wrangler.toml" ]; then
        awk -v binding="$binding" -v type="$type" '
        /^\[\[kv_namespaces\]\]/ { in_kv = 1; found_binding = 0; next }
        /^\[/ && !/^\[\[kv_namespaces\]\]/ { in_kv = 0; next }
        in_kv && /^binding = / {
            if ($3 == "\"" binding "\"") found_binding = 1
            next
        }
        in_kv && found_binding && $1 == type {
            gsub(/"/, "", $3)
            print $3
            exit
        }
        ' wrangler.toml
    fi
}

# Function to check if a namespace exists in Cloudflare
namespace_exists() {
    local namespace_id="$1"
    if [ -z "$namespace_id" ]; then
        return 1
    fi
    
    npx wrangler kv namespace list 2>/dev/null | grep -q "$namespace_id"
}

# Function to create or verify namespace
setup_namespace() {
    local name="$1"
    local binding="$2"
    local preview_flag="$3"
    local id_type="id"
    local display_suffix=""
    
    if [ "$preview_flag" = "--preview" ]; then
        id_type="preview_id"
        display_suffix="_preview"
    fi
    
    echo "Checking $binding$display_suffix namespace..." >&2
    
    # Try to get existing ID from wrangler.toml
    existing_id=$(get_existing_namespace_id "$binding" "$id_type")
    
    if [ -n "$existing_id" ] && namespace_exists "$existing_id"; then
        echo "✅ Found existing $binding$display_suffix with ID: $existing_id" >&2
        echo "$existing_id"
        return 0
    fi
    
    # Create new namespace
    echo "Creating new $binding$display_suffix namespace..." >&2
    if [ "$preview_flag" = "--preview" ]; then
        output=$(npx wrangler kv namespace create "$name" --preview 2>/dev/null)
        if [[ $output =~ preview_id\ =\ \"([^\"]+)\" ]]; then
            new_id="${BASH_REMATCH[1]}"
            echo "✅ Created $binding$display_suffix with ID: $new_id" >&2
            echo "$new_id"
            return 0
        fi
    else
        output=$(npx wrangler kv namespace create "$name" 2>/dev/null)
        if [[ $output =~ id\ =\ \"([^\"]+)\" ]]; then
            new_id="${BASH_REMATCH[1]}"
            echo "✅ Created $binding with ID: $new_id" >&2
            echo "$new_id"
            return 0
        fi
    fi
    
    echo "❌ Failed to create $binding$display_suffix namespace" >&2
    return 1
}

# Setup all production namespaces
oauth_tokens_id=$(setup_namespace "OAUTH_TOKENS" "OAUTH_TOKENS")
if [ $? -ne 0 ]; then exit 1; fi

oauth_state_id=$(setup_namespace "OAUTH_STATE" "OAUTH_STATE")
if [ $? -ne 0 ]; then exit 1; fi

edge_tokens_id=$(setup_namespace "EDGE_TOKENS" "EDGE_TOKENS")
if [ $? -ne 0 ]; then exit 1; fi

workspace_metadata_id=$(setup_namespace "WORKSPACE_METADATA" "WORKSPACE_METADATA")
if [ $? -ne 0 ]; then exit 1; fi

echo ""

# Setup all preview namespaces
oauth_tokens_preview_id=$(setup_namespace "OAUTH_TOKENS" "OAUTH_TOKENS" "--preview")
if [ $? -ne 0 ]; then exit 1; fi

oauth_state_preview_id=$(setup_namespace "OAUTH_STATE" "OAUTH_STATE" "--preview")
if [ $? -ne 0 ]; then exit 1; fi

edge_tokens_preview_id=$(setup_namespace "EDGE_TOKENS" "EDGE_TOKENS" "--preview")
if [ $? -ne 0 ]; then exit 1; fi

workspace_metadata_preview_id=$(setup_namespace "WORKSPACE_METADATA" "WORKSPACE_METADATA" "--preview")
if [ $? -ne 0 ]; then exit 1; fi

echo ""
echo "📝 Generating wrangler.toml from template..."

# Backup existing wrangler.toml if it exists
if [ -f "wrangler.toml" ]; then
    cp wrangler.toml wrangler.toml.backup
    echo "💾 Created backup: wrangler.toml.backup"
fi

# Generate wrangler.toml from template by replacing placeholders
# Clean variables to remove any newlines or special characters
oauth_tokens_id=$(echo "$oauth_tokens_id" | tr -d '\n\r')
oauth_tokens_preview_id=$(echo "$oauth_tokens_preview_id" | tr -d '\n\r')
oauth_state_id=$(echo "$oauth_state_id" | tr -d '\n\r')
oauth_state_preview_id=$(echo "$oauth_state_preview_id" | tr -d '\n\r')
edge_tokens_id=$(echo "$edge_tokens_id" | tr -d '\n\r')
edge_tokens_preview_id=$(echo "$edge_tokens_preview_id" | tr -d '\n\r')
workspace_metadata_id=$(echo "$workspace_metadata_id" | tr -d '\n\r')
workspace_metadata_preview_id=$(echo "$workspace_metadata_preview_id" | tr -d '\n\r')

# Use a more robust approach with temporary file
temp_file=$(mktemp)
cp wrangler.toml.template "$temp_file"

# Replace each placeholder individually to avoid sed escaping issues
sed -i.bak "s|{{OAUTH_TOKENS_ID}}|$oauth_tokens_id|g" "$temp_file"
sed -i.bak "s|{{OAUTH_TOKENS_PREVIEW_ID}}|$oauth_tokens_preview_id|g" "$temp_file"
sed -i.bak "s|{{OAUTH_STATE_ID}}|$oauth_state_id|g" "$temp_file"
sed -i.bak "s|{{OAUTH_STATE_PREVIEW_ID}}|$oauth_state_preview_id|g" "$temp_file"
sed -i.bak "s|{{EDGE_TOKENS_ID}}|$edge_tokens_id|g" "$temp_file"
sed -i.bak "s|{{EDGE_TOKENS_PREVIEW_ID}}|$edge_tokens_preview_id|g" "$temp_file"
sed -i.bak "s|{{WORKSPACE_METADATA_ID}}|$workspace_metadata_id|g" "$temp_file"
sed -i.bak "s|{{WORKSPACE_METADATA_PREVIEW_ID}}|$workspace_metadata_preview_id|g" "$temp_file"

# Move the processed file to wrangler.toml
mv "$temp_file" wrangler.toml
rm -f "$temp_file.bak"

echo "✅ Generated wrangler.toml from template with namespace IDs"

echo ""
echo "🎉 Setup complete! Your Wrangler workspace is ready."
echo ""
echo "📋 Summary:"
echo "  - Checked for existing KV namespaces"
echo "  - Created any missing KV namespaces"
echo "  - Generated wrangler.toml from template"
if [ -f "wrangler.toml.backup" ]; then
    echo "  - Backup saved as wrangler.toml.backup"
fi
echo ""
echo "⚠️  IMPORTANT: You must now configure the required secrets!"
echo ""
echo "🔐 Required Secrets Setup:"
echo "  1. Create a Linear OAuth app at:"
echo "     https://linear.app/settings/api/applications/new"
echo "     - Enable webhooks and select 'Agent session events'"
echo "     - Copy Client ID, Client Secret, and Webhook Secret"
echo ""
echo "  2. Generate an encryption key:"
echo "     openssl rand -hex 32"
echo ""
echo "  3. Set the secrets using these commands:"
echo "     npx wrangler secret put LINEAR_CLIENT_ID"
echo "     npx wrangler secret put LINEAR_CLIENT_SECRET"
echo "     npx wrangler secret put LINEAR_WEBHOOK_SECRET"
echo "     npx wrangler secret put ENCRYPTION_KEY"
echo ""
echo "     For preview environment, add --env preview to each command"
echo ""
echo "🚀 After setting secrets:"
echo "  - Run 'npm run dev' to start development"
echo "  - Run 'npm run deploy' to deploy to production"
echo "  - Run 'npx wrangler kv namespace list' to see all namespaces"
echo ""
echo "💡 Tip: If you encounter 'There is already a user in Linear associated with this Github account',"
echo "   you may need to create a new GitHub username for your Linear agent."
echo ""
