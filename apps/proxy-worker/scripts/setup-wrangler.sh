#!/bin/bash

# Cyrus Proxy Worker - Wrangler Setup Script
# This script automatically creates KV namespaces and configures wrangler.toml

set -e  # Exit on any error

# Parse command line arguments
RUN_DEV=false
RUN_DEPLOY=false
RUN_PREVIEW=false
FORCE_SECRETS=false

for arg in "$@"; do
    case $arg in
        --dev)
            RUN_DEV=true
            shift
            ;;
        --deploy)
            RUN_DEPLOY=true
            shift
            ;;
        --preview)
            RUN_PREVIEW=true
            shift
            ;;
        --force-secrets)
            FORCE_SECRETS=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dev            Run development server after setup"
            echo "  --deploy         Deploy to production after setup"
            echo "  --preview        Upload preview version and get preview URL"
            echo "  --force-secrets  Force update all secrets even if they exist"
            echo "  --help, -h       Show this help message"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Use --help for available options"
            exit 1
            ;;
    esac
done

echo "🚀 Setting up Wrangler workspace for Cyrus Proxy Worker..."

# Check if we're in the right directory
if [ ! -f "wrangler.toml.template" ]; then
    echo "❌ Error: wrangler.toml.template not found. Please run this script from the proxy-worker directory."
    exit 1
fi

# Source .env file if it exists to load environment variables
if [ -f ".env" ]; then
    echo "📋 Sourcing environment variables from .env file..."
    source .env
    echo "✅ Environment variables loaded from .env"
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

# Check for PROXY_URL and validate
if [ -z "$PROXY_URL" ]; then
    echo "⚠️  PROXY_URL not set - will use DEFAULT_PROXY_URL=https://cyrus-proxy.ceedar.workers.dev"
    echo "   For custom deployments, set: export PROXY_URL=https://your-worker.your-domain.workers.dev"
    echo ""
else
    echo "✅ PROXY_URL detected: $PROXY_URL"
    # Validate URL format
    if [[ ! "$PROXY_URL" =~ ^https:// ]]; then
        echo "❌ PROXY_URL must use HTTPS protocol"
        exit 1
    fi
fi

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

    # First, try to get existing ID from wrangler.toml
    existing_id=$(get_existing_namespace_id "$binding" "$id_type")

    if [ -n "$existing_id" ] && namespace_exists "$existing_id"; then
        echo "✅ Found existing $binding$display_suffix with ID: $existing_id" >&2
        echo "$existing_id"
        return 0
    fi

    # If no existing ID in wrangler.toml, check if namespace exists in Cloudflare
    echo "Checking for existing $name namespace in Cloudflare..." >&2
    cloudflare_list=$(npx wrangler kv namespace list 2>/dev/null)

    # For preview namespaces, check for the name with _preview suffix
    check_name="$name"
    if [ "$preview_flag" = "--preview" ]; then
        check_name="${name}_preview"
    fi

    if echo "$cloudflare_list" | grep -q "\"title\": \"$check_name\""; then
        # Extract the existing ID from Cloudflare using simpler approach
        if [ "$preview_flag" = "--preview" ]; then
            existing_id=$(echo "$cloudflare_list" | grep -B 5 -A 5 "\"title\": \"$check_name\"" | grep "\"id\":" | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')
        else
            existing_id=$(echo "$cloudflare_list" | grep -B 5 -A 5 "\"title\": \"$check_name\"" | grep "\"id\":" | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')
        fi

        if [ -n "$existing_id" ] && [ "$existing_id" != "null" ]; then
            echo "✅ Found existing $binding$display_suffix in Cloudflare with ID: $existing_id" >&2
            echo "$existing_id"
            return 0
        fi
    fi

    # Create new namespace
    echo "Creating new $binding$display_suffix namespace..." >&2
    if [ "$preview_flag" = "--preview" ]; then
        output=$(npx wrangler kv namespace create "$name" --preview)
        if [[ $output =~ \"preview_id\":\ \"([^\"]+)\" ]]; then
            new_id="${BASH_REMATCH[1]}"
            echo "✅ Created $binding$display_suffix with ID: $new_id" >&2
            echo "$new_id"
            return 0
        fi
    else
        output=$(npx wrangler kv namespace create "$name")
        if [[ $output =~ \"id\":\ \"([^\"]+)\" ]]; then
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

# Replace PROXY_URL if available, otherwise remove the line
if [ -n "$PROXY_URL" ]; then
    sed -i.bak "s|{{PROXY_URL}}|$PROXY_URL|g" "$temp_file"
else
    # Remove the PROXY_URL line if not set (will use DEFAULT_PROXY_URL)
    sed -i.bak "/{{PROXY_URL}}/d" "$temp_file"
fi

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
echo "🔐 Configuring secrets..."
echo ""

# Check environment variables
check_env_vars() {
    echo "📋 Checking environment variables..."

    local found_vars=0

    if [ -n "$LINEAR_CLIENT_ID" ]; then
        echo "✅ LINEAR_CLIENT_ID found"
        found_vars=$((found_vars + 1))
    fi

    if [ -n "$LINEAR_CLIENT_SECRET" ]; then
        echo "✅ LINEAR_CLIENT_SECRET found"
        found_vars=$((found_vars + 1))
    fi

    if [ -n "$LINEAR_WEBHOOK_SECRET" ]; then
        echo "✅ LINEAR_WEBHOOK_SECRET found"
        found_vars=$((found_vars + 1))
    fi

    if [ -n "$ENCRYPTION_KEY" ]; then
        echo "✅ ENCRYPTION_KEY found"
        found_vars=$((found_vars + 1))
    fi

    echo "Found $found_vars out of 4 required environment variables"
}

# Check environment variables
check_env_vars

# Generate encryption key if not provided
generate_encryption_key() {
    if [ -z "$ENCRYPTION_KEY" ]; then
        echo "🔑 Generating encryption key..."
        ENCRYPTION_KEY=$(openssl rand -hex 32)
        if [ $? -eq 0 ]; then
            echo "✅ Generated 32-byte encryption key"

            # Append to .env file
            echo "" >> .env
            echo "# Auto-generated encryption key" >> .env
            echo "export ENCRYPTION_KEY=\"$ENCRYPTION_KEY\"" >> .env
            echo "💾 Saved encryption key to .env file"
        else
            echo "❌ Failed to generate encryption key. Please install openssl."
            echo "   Alternative: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
            exit 1
        fi
    else
        echo "✅ Using existing ENCRYPTION_KEY from environment"
    fi
}

# Function to check if secret exists (returns "exists" or empty)
get_current_secret() {
    local secret_name="$1"
    local secret_list=$(npx wrangler secret list 2>/dev/null)

    if echo "$secret_list" | grep -q "\"name\": \"$secret_name\""; then
        echo "exists"
    else
        echo ""
    fi
}

# Function to set a secret only if it's different or missing
set_secret_if_changed() {
    local secret_name="$1"
    local env_var_name="$2"
    local env_value="${!env_var_name}"

    if [ -n "$env_value" ]; then
        # Check if secret exists
        local current_secret=$(get_current_secret "$secret_name")

        if [ -n "$current_secret" ] && [ "$FORCE_SECRETS" != true ]; then
            echo "ℹ️  $secret_name already exists - skipping (use --force-secrets to override)"
            secrets_skipped=$((secrets_skipped + 1))
        else
            echo "🔒 Setting $secret_name..."
            if echo "$env_value" | npx wrangler secret put "$secret_name" >/dev/null 2>&1; then
                echo "✅ Set $secret_name"
                secrets_set=$((secrets_set + 1))
            else
                echo "❌ Failed to set $secret_name"
                echo "   This might require deploying the worker first"
                secrets_failed+=("$secret_name")
            fi
        fi
    else
        echo "⚠️  $env_var_name not found in environment - skipping $secret_name"
        secrets_failed+=("$secret_name")
    fi
}

# Generate encryption key if needed
generate_encryption_key

# Track which secrets were set successfully
secrets_set=0
secrets_failed=()
secrets_skipped=0

# Set secrets from environment variables (only if changed/missing)
echo "🔒 Configuring secrets from environment variables..."

# Process each secret (function handles counting internally)
set_secret_if_changed "LINEAR_CLIENT_ID" "LINEAR_CLIENT_ID"
set_secret_if_changed "LINEAR_CLIENT_SECRET" "LINEAR_CLIENT_SECRET"
set_secret_if_changed "LINEAR_WEBHOOK_SECRET" "LINEAR_WEBHOOK_SECRET"
set_secret_if_changed "ENCRYPTION_KEY" "ENCRYPTION_KEY"

echo ""

# Report results
total_configured=$((secrets_set + secrets_skipped))

if [ $total_configured -eq 4 ]; then
    echo "🎉 All secrets are configured!"
    if [ $secrets_skipped -gt 0 ]; then
        echo "   ($secrets_skipped already existed, $secrets_set newly set)"
    fi
    echo ""
    echo "🚀 Ready to deploy! Choose your next step:"
    echo ""
    echo "  Development mode:"
    echo "    npm run dev"
    echo "    # or: npx wrangler dev --port 8787"
    echo ""
    echo "  Deploy to production:"
    echo "    npm run deploy"
    echo "    # or: npx wrangler deploy"
    echo ""
    echo "  Create preview version (test without affecting production):"
    echo "    npm run preview"
    echo "    # or: npx wrangler versions upload"
    echo ""
elif [ $total_configured -gt 0 ]; then
    echo "✅ Secrets configured: $secrets_set newly set, $secrets_skipped already existed"

    if [ ${#secrets_failed[@]} -gt 0 ]; then
        echo "⚠️  Failed secrets: ${secrets_failed[*]}"
        echo ""
        echo "🔐 To set the missing secrets manually:"
        for secret in "${secrets_failed[@]}"; do
            echo "    npx wrangler secret put $secret"
        done
    fi
else
    echo "⚠️  No secrets were set automatically"
    echo ""
    echo "🔐 Manual secret setup required:"
    echo ""
    echo "  1. Create a Linear OAuth app at:"
    echo "     https://linear.app/settings/api/applications/new"
    echo "     - Enable webhooks and select 'Agent session events'"
    echo "     - Copy Client ID, Client Secret, and Webhook Secret"
    echo ""
    echo "  2. Set the secrets using these commands:"
    echo "     npx wrangler secret put LINEAR_CLIENT_ID"
    echo "     npx wrangler secret put LINEAR_CLIENT_SECRET"
    echo "     npx wrangler secret put LINEAR_WEBHOOK_SECRET"
    echo "     npx wrangler secret put ENCRYPTION_KEY"
    echo ""
    echo "     For preview environment, add --env preview to each command"
fi

echo ""
echo "📊 Useful Commands:"
echo "  - View logs: npm run tail (or npx wrangler tail)"
echo "  - List namespaces: npx wrangler kv namespace list"
echo "  - List secrets: npx wrangler secret list"
echo "  - View worker info: npx wrangler whoami"
echo ""
echo "💡 Tip: If you encounter 'There is already a user in Linear associated with this Github account',"
echo "   you may need to create a new GitHub username for your Linear agent."
echo ""

# Execute requested action based on CLI arguments
if [ "$RUN_DEV" = true ]; then
    echo "🚀 Starting development server..."
    echo ""
    exec npm run dev
elif [ "$RUN_DEPLOY" = true ]; then
    echo "🚀 Deploying to production..."
    echo ""
    exec npm run deploy
elif [ "$RUN_PREVIEW" = true ]; then
    echo "🚀 Uploading preview version..."
    echo ""
    exec npm run preview
fi
