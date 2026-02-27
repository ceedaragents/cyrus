# syntax=docker/dockerfile:1

# ─── base ────────────────────────────────────────────────────────────────────
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    jq \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

# ─── deps ────────────────────────────────────────────────────────────────────
# Separate layer for dependency caching — rebuild only when package.json or lockfile changes
FROM base AS deps

# Copy workspace config and all package.json files for dependency install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc* ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/f1/package.json apps/f1/package.json
COPY packages/admin-dashboard/package.json packages/admin-dashboard/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/claude-runner/package.json packages/claude-runner/package.json
COPY packages/cloudflare-tunnel-client/package.json packages/cloudflare-tunnel-client/package.json
COPY packages/codex-runner/package.json packages/codex-runner/package.json
COPY packages/config-updater/package.json packages/config-updater/package.json
COPY packages/cursor-runner/package.json packages/cursor-runner/package.json
COPY packages/edge-worker/package.json packages/edge-worker/package.json
COPY packages/gemini-runner/package.json packages/gemini-runner/package.json
COPY packages/github-event-transport/package.json packages/github-event-transport/package.json
COPY packages/linear-event-transport/package.json packages/linear-event-transport/package.json
COPY packages/mcp-tools/package.json packages/mcp-tools/package.json
COPY packages/simple-agent-runner/package.json packages/simple-agent-runner/package.json
COPY packages/slack-event-transport/package.json packages/slack-event-transport/package.json

RUN pnpm install --frozen-lockfile

# ─── build ───────────────────────────────────────────────────────────────────
FROM base AS build

# Copy cached node_modules from deps stage
COPY --from=deps /app /app

# Copy source code into a separate location, then merge without clobbering node_modules
COPY . /tmp/src
RUN cp -a /tmp/src/. /app/ && rm -rf /tmp/src

# Rebuild pnpm symlinks after source overlay
RUN pnpm install --frozen-lockfile

RUN pnpm -r --filter='!@cyrus/electron' --filter='!cyrus-f1' build

# ─── production ──────────────────────────────────────────────────────────────
FROM base AS production

# Repurpose the existing node user (UID/GID 1000) as cyrus
RUN usermod -l cyrus -d /home/cyrus -m node \
  && groupmod -n cyrus node

WORKDIR /app

# Copy built application from build stage
COPY --from=build --chown=cyrus:cyrus /app /app

# Configure git identity for the cyrus user
RUN git config --system user.name "Cyrus" \
  && git config --system user.email "cyrus@ceedar.com" \
  && git config --system --add safe.directory '*'

# Create data directory (will be overlaid by EFS mount)
RUN mkdir -p /home/cyrus/.cyrus && chown -R cyrus:cyrus /home/cyrus/.cyrus

USER cyrus

ENV NODE_ENV=production
ENV CYRUS_HOST_EXTERNAL=true

EXPOSE 3456

CMD ["node", "apps/cli/dist/src/app.js", "start"]
