#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# Cyrus Deploy Script
# Deploys a branch from a fork to a VPS
# --------------------------------------------------

REPO_URL="${CYRUS_REPO_URL:-https://github.com/AEMusic/cyrus.git}"
BRANCH="${CYRUS_BRANCH:-feat/multi-agents}"
INSTALL_DIR="${CYRUS_INSTALL_DIR:-/opt/cyrus}"
SERVICE_NAME="${CYRUS_SERVICE:-cyrus}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[cyrus-deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[cyrus-deploy]${NC} $*"; }
err()  { echo -e "${RED}[cyrus-deploy]${NC} $*" >&2; }

# --------------------------------------------------
# Pre-flight checks
# --------------------------------------------------
check_dependencies() {
    local missing=()
    for cmd in git node pnpm; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done

    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing dependencies: ${missing[*]}"
        err "Install them before running this script."
        exit 1
    fi

    local node_major
    node_major=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -lt 18 ]; then
        err "Node.js >= 18 required (found $(node -v))"
        exit 1
    fi

    log "Dependencies OK: node $(node -v), pnpm $(pnpm -v)"
}

# --------------------------------------------------
# Remove existing npm global installation
# --------------------------------------------------
remove_npm_global() {
    if npm list -g cyrus-ai &>/dev/null 2>&1; then
        warn "Removing existing global cyrus-ai npm package..."
        npm uninstall -g cyrus-ai
        log "Global cyrus-ai removed."
    else
        log "No existing global cyrus-ai installation found."
    fi
}

# --------------------------------------------------
# Clone or update the repository
# --------------------------------------------------
setup_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        log "Repository exists at $INSTALL_DIR, updating..."
        cd "$INSTALL_DIR"
        git fetch origin
        git checkout "$BRANCH"
        git reset --hard "origin/$BRANCH"
    else
        log "Cloning $REPO_URL ($BRANCH) into $INSTALL_DIR..."
        sudo mkdir -p "$INSTALL_DIR"
        sudo chown "$(whoami):$(whoami)" "$INSTALL_DIR"
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi

    log "On branch: $(git branch --show-current) @ $(git rev-parse --short HEAD)"
}

# --------------------------------------------------
# Build
# --------------------------------------------------
build() {
    cd "$INSTALL_DIR"
    log "Installing dependencies..."
    pnpm install --frozen-lockfile

    log "Building all packages..."
    pnpm build

    log "Build complete."
}

# --------------------------------------------------
# Link the CLI globally
# --------------------------------------------------
link_cli() {
    cd "$INSTALL_DIR/apps/cli"

    log "Linking cyrus CLI globally..."
    pnpm link --global

    if command -v cyrus &>/dev/null; then
        log "cyrus CLI available at: $(which cyrus)"
    else
        warn "cyrus not found in PATH. You may need to add pnpm global bin to PATH:"
        warn "  export PATH=\"\$(pnpm -g bin):\$PATH\""
    fi
}

# --------------------------------------------------
# Restart systemd service
# --------------------------------------------------
restart_service() {
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null || \
       systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        log "Restarting $SERVICE_NAME service..."
        sudo systemctl restart "$SERVICE_NAME"
        sleep 2
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            log "$SERVICE_NAME is running."
        else
            err "$SERVICE_NAME failed to start. Check logs:"
            err "  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
            exit 1
        fi
    else
        warn "No systemd service '$SERVICE_NAME' found. Start cyrus manually or create the service."
    fi
}

# --------------------------------------------------
# Main
# --------------------------------------------------
main() {
    log "Deploying Cyrus ($BRANCH) to $INSTALL_DIR"
    echo ""

    check_dependencies
    remove_npm_global
    setup_repo
    build
    link_cli
    restart_service

    echo ""
    log "Deploy complete!"
    log "  Branch:  $BRANCH"
    log "  Dir:     $INSTALL_DIR"
    log "  Commit:  $(cd "$INSTALL_DIR" && git rev-parse --short HEAD)"
    log "  Service: $SERVICE_NAME"
}

main "$@"
