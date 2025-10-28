# Cyrus Codebase Analysis - Complete Index

## Overview

This analysis provides a comprehensive map of the Cyrus codebase architecture, focusing on webhook handling, OAuth flows, and component integration.

**Total Documentation**: 3 markdown files + this index
**Generated**: October 27, 2025
**Scope**: Complete codebase structure, component relationships, and current implementation patterns

---

## Document Map

### 1. ANALYSIS_SUMMARY.md (Start Here)
**Purpose**: Quick reference guide with key findings
**Length**: ~350 lines
**Best For**: Getting oriented quickly, understanding high-level architecture

**Contains**:
- Key findings summary
- Component relationships overview
- Handler registration patterns
- Quick reference table
- File locations
- Integration points
- Next steps for development

**Read This If**: You want a quick understanding or are new to the codebase

---

### 2. CODEBASE_ARCHITECTURE.md (Main Reference)
**Purpose**: Complete technical documentation
**Length**: ~900 lines
**Best For**: Deep understanding, implementation details, decision making

**Contains**:
- Executive summary
- Package structure (7 packages + 2 apps)
- Component deep dives:
  - SharedApplicationServer.ts (1,133 lines)
  - LinearEventTransport package
  - CloudflareTunnelClient package
  - EdgeWorker.ts
- Webhook flow diagrams
- Handler registration signatures
- OAuth flows (proxy and direct)
- Current usage patterns
- Design patterns
- Dependencies and imports
- Environment variables
- Current state summary

**Read This If**: You need detailed technical information, planning changes, or understanding implementation

---

### 3. ARCHITECTURE_DIAGRAM.md (Visual Reference)
**Purpose**: ASCII diagrams and visual flows
**Length**: ~800 lines
**Best For**: Understanding flow, visualization, presentation

**Contains**:
- High-level component architecture
- Webhook flow architecture
- Request flow for registration
- Handler call stack
- Data flow: token to handler
- Port and URL resolution
- Complete integration example
- Step-by-step webhook handling

**Read This If**: You prefer visual representations, learning flow patterns, or explaining to others

---

## Quick Navigation by Topic

### Understanding the Webhook Architecture
1. Start: ANALYSIS_SUMMARY.md → "Current Architecture" section
2. Deep dive: CODEBASE_ARCHITECTURE.md → "SharedApplicationServer.ts" section
3. Visualize: ARCHITECTURE_DIAGRAM.md → "Webhook Flow Architecture"

### Implementing Handler Registration
1. Quick ref: ANALYSIS_SUMMARY.md → "Handler Registration Pattern"
2. Details: CODEBASE_ARCHITECTURE.md → "Handler Registration Signatures"
3. Example: ARCHITECTURE_DIAGRAM.md → "Complete Integration Example"

### OAuth Flow Understanding
1. Overview: ANALYSIS_SUMMARY.md → "Webhook Endpoints"
2. Implementation: CODEBASE_ARCHITECTURE.md → "OAuth Flow"
3. Call path: ARCHITECTURE_DIAGRAM.md → "Port and URL Resolution"

### Port and URL Configuration
1. Quick ref: ANALYSIS_SUMMARY.md → "Configuration"
2. Environment vars: CODEBASE_ARCHITECTURE.md → "Configuration Environment Variables"
3. Visual flow: ARCHITECTURE_DIAGRAM.md → "Port and URL Resolution"

### Finding File Locations
1. Quick map: ANALYSIS_SUMMARY.md → "File Locations Reference"
2. Full paths: CODEBASE_ARCHITECTURE.md → Any component section
3. Context: ARCHITECTURE_DIAGRAM.md → "High-Level Component Architecture"

---

## Key Components at a Glance

### SharedApplicationServer
- **File**: `/packages/edge-worker/src/SharedApplicationServer.ts`
- **Lines**: 1,133
- **Role**: Central webhook router and OAuth handler
- **Key Methods**: start(), stop(), registerWebhookHandler(), startOAuthFlow()
- **Features**: ngrok tunnel, dual webhook styles, OAuth callback handling

### LinearEventTransport
- **File**: `/packages/linear-event-transport/`
- **Role**: Direct Linear webhook client
- **Key Feature**: Linear SDK HMAC signature verification
- **Handler Signature**: `(req, res) => Promise<void>`

### CloudflareTunnelClient
- **File**: `/packages/cloudflare-tunnel-client/`
- **Role**: Remote tunnel for cloud deployment
- **Key Feature**: Token-based tunnel establishment

### EdgeWorker
- **File**: `/packages/edge-worker/src/EdgeWorker.ts`
- **Role**: Orchestration engine
- **Key Feature**: Client management and webhook routing

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                 INCOMING WEBHOOKS                       │
│  (Direct, ngrok, or Cloudflare tunnel)                  │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────▼──────────────┐
         │ SharedApplicationServer    │
         │ - Verifies HMAC signature  │
         │ - Routes to handler        │
         └──────────────┬──────────────┘
                        │
                        ▼
          ┌──────────────────────────┐
          │ LinearEventTransport     │
          │ Handler                  │
          └──────────────┬───────────┘
                         │
                  ┌──────▼─────────┐
                  │ EdgeWorker     │
                  │ handleWebhook()│
                  │ - Parse        │
                  │ - Create       │
                  │   session      │
                  │ - Run Claude   │
                  │ - Post Linear  │
                  └────────────────┘
```

---

## Implementation Patterns

### Pattern 1: Unified Webhook Server
Multiple webhook types handled by single HTTP server
- Benefit: Single port, less complexity
- Used by: All webhook clients via SharedApplicationServer

### Pattern 2: External Server Integration
Transports support passing external HTTP server
- Benefit: Shared resources, scalability
- Used by: LinearEventTransport

### Pattern 3: Handler Registry
Token-keyed handler storage with sequential attempts
- Benefit: Dynamic handler management
- Used by: SharedApplicationServer

### Pattern 4: Promise-Based OAuth
OAuth flow returns Promise that resolves on callback
- Benefit: Async/await style, timeout support
- Used by: SharedApplicationServer.startOAuthFlow()

---

## Configuration Quick Reference

### Essential Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| CYRUS_SERVER_PORT | 3456 | HTTP server port |
| CYRUS_BASE_URL | (none) | Override base URL |
| CYRUS_HOST_EXTERNAL | (none) | Use external host |
| LINEAR_CLIENT_ID | (none) | Direct OAuth client ID |
| LINEAR_CLIENT_SECRET | (none) | Direct OAuth secret |
| PROXY_URL | cyrus-proxy.com | Proxy server URL |
| LINEAR_WEBHOOK_SECRET | (none) | Webhook secret |
| LINEAR_DIRECT_WEBHOOKS | (none) | Use direct webhooks |

---

## Development Workflows

### Understanding a Component
1. Read ANALYSIS_SUMMARY.md component overview
2. Check CODEBASE_ARCHITECTURE.md section
3. Review ARCHITECTURE_DIAGRAM.md flow
4. Read source code with context

### Adding a New Feature
1. Check CODEBASE_ARCHITECTURE.md for relevant patterns
2. Reference ARCHITECTURE_DIAGRAM.md for integration point
3. Review similar implementation in source
4. Check configuration requirements

### Debugging Webhook Flow
1. Start at ARCHITECTURE_DIAGRAM.md "Webhook Flow Architecture"
2. Check handler signatures in CODEBASE_ARCHITECTURE.md
3. Review error paths in SharedApplicationServer.ts
4. Check handler registry maps

---

## Key Design Decisions

### 1. Unified Webhook Server (vs. individual servers)
- **Decision**: Use single SharedApplicationServer
- **Reason**: Eliminate port conflicts, simplify management
- **Impact**: Clients register handlers dynamically

### 2. Dual Webhook Styles (proxy and direct)
- **Decision**: Support both NdjsonClient and LinearWebhookClient
- **Reason**: Flexibility for different deployment scenarios
- **Impact**: Two handler registration patterns

### 3. External Server Integration
- **Decision**: Allow clients to use external server
- **Reason**: Enable resource sharing
- **Impact**: Optional `useExternalWebhookServer` config

### 4. Header-Based Detection
- **Decision**: Route based on webhook headers
- **Reason**: Determine webhook type at routing time
- **Impact**: No configuration needed for webhook type

---

## Statistics

| Metric | Count |
|--------|-------|
| Main packages | 7 |
| Apps | 2 |
| Webhook handler types | 2 |
| OAuth modes | 2 |
| Tunnel types | 2 |
| HTTP endpoints | 4 |
| Handler registry maps | 2 |
| Signature schemes | 2 |
| Total documentation lines | 2,500+ |

---

## Common Questions Answered

### Q: Where is the main webhook server?
**A**: SharedApplicationServer in `/packages/edge-worker/src/SharedApplicationServer.ts`

### Q: How are webhooks routed?
**A**: By header detection (linear-signature for direct, x-webhook-signature for proxy)

### Q: Can multiple clients share one server?
**A**: Yes, via `externalWebhookServer` config

### Q: What port is used?
**A**: Configurable via CYRUS_SERVER_PORT (default 3456)

### Q: How does OAuth work?
**A**: Two modes: proxy-based (default) or direct Linear OAuth (with CYRUS_HOST_EXTERNAL=true)

### Q: What is the difference between NdjsonClient and LinearWebhookClient?
**A**: NdjsonClient is proxy-based (HMAC), LinearWebhookClient is direct (Linear SDK)

---

## Document Statistics

| Document | Lines | Size | Focus |
|----------|-------|------|-------|
| ANALYSIS_SUMMARY.md | 350 | 9.7K | Quick ref |
| CODEBASE_ARCHITECTURE.md | 900 | 24K | Deep dive |
| ARCHITECTURE_DIAGRAM.md | 800 | 32K | Visual |
| Total | 2,050 | 66K | Complete |

---

## How to Use These Documents

### For Quick Understanding
1. Read ANALYSIS_SUMMARY.md completely
2. Skim ARCHITECTURE_DIAGRAM.md for visual understanding
3. Refer to specific sections as needed

### For Implementation
1. Review CODEBASE_ARCHITECTURE.md component section
2. Check configuration in ANALYSIS_SUMMARY.md
3. Use ARCHITECTURE_DIAGRAM.md for flow understanding
4. Reference source code

### For Teaching/Explaining
1. Start with ARCHITECTURE_DIAGRAM.md visuals
2. Supplement with ANALYSIS_SUMMARY.md explanations
3. Deep dive to CODEBASE_ARCHITECTURE.md for details
4. Show actual source code

### For Debugging
1. Use ARCHITECTURE_DIAGRAM.md to understand flow
2. Check CODEBASE_ARCHITECTURE.md error handling
3. Review handler signatures
4. Trace through source code

---

## Updates and Maintenance

These documents are current as of October 27, 2025.

**To keep updated**:
- Note changes to SharedApplicationServer handlers
- Update webhook flow if new types added
- Revise handler signatures if changed
- Update configuration if new env vars added

**To extend these documents**:
- Add new component sections to CODEBASE_ARCHITECTURE.md
- Create new diagrams in ARCHITECTURE_DIAGRAM.md
- Update statistics in this index
- Add FAQ entries

---

## Related Documentation

- **CLAUDE.md**: Project overview and development guidelines
- **CRITICAL_ISSUES.md**: Known issues and limitations
- **CHANGELOG.md**: Release notes and version history
- **README.md**: General project information

---

## Contact/Questions

For questions about this analysis:
1. Review the relevant document section
2. Check ARCHITECTURE_DIAGRAM.md for visual clarification
3. Read source code with document context
4. Refer to CLAUDE.md for development guidelines

---

**Last Updated**: October 27, 2025
**Analysis Scope**: Complete codebase architecture
**Documentation Type**: Technical reference
**Audience**: Developers, architects, contributors
