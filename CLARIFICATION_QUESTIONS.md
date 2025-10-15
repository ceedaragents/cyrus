# Clarification Questions for CYPACK-185

**Date**: 2025-10-14
**Context**: Semi-Hosted Onboarding Architecture Planning

---

## Critical Decisions Needed

### 1. ngrok Tier Requirements

**Question**: Should we require users to have an ngrok paid subscription ($8/month)?

**Context**:
- Free tier: Random URL that changes on restart (e.g., `abc-123-def.ngrok-free.app`)
- Paid tier: Reserved subdomain that persists (e.g., `my-company.ngrok-free.app`)

**Options**:
- **A) Require paid tier**: More stable, better UX, one-time setup
- **B) Allow free tier**: Lower barrier to entry, but users must update URL in Vercel app after each restart

**Recommendation**: Option A (require paid tier) for better UX and reliability

---

### 2. CLI Distribution Method

**Question**: How should we distribute the closed-source `config-server` package?

**Context**: We want to keep update-server logic closed-source while keeping the rest of Cyrus open-source.

**Options**:

**A) Private npm package** (RECOMMENDED)
- Cost: $7/month for npm Teams plan
- Users authenticate: `npm login --scope=@cyrus-ai`
- Standard npm workflow
- Easy to maintain

**B) Separate private repository + runtime download**
- CLI downloads package from CDN at runtime
- More control, but complex implementation
- Requires hosting CDN

**C) Obfuscated code in public repo**
- Security through obscurity
- Not recommended for serious IP protection

**Recommendation**: Option A (private npm package)

---

### 3. Webhook Routing Strategy

**Question**: How should Linear webhooks reach the customer's CLI?

**Options**:

**A) Proxy routing** (RECOMMENDED)
```
Linear → Vercel → ngrok → CLI
```
- Single webhook URL (no customer configuration)
- Vercel validates signatures
- Vercel can log/monitor traffic
- Adds 50-100ms latency

**B) Direct routing**
```
Linear → ngrok → CLI
```
- Lower latency
- Customer must configure Linear webhook URL
- Customer's ngrok URL can't change without updating Linear
- Less visibility into webhook traffic

**Recommendation**: Option A (proxy routing) for better reliability and UX

---

### 4. Backward Compatibility

**Question**: Should we maintain both fully-hosted (droplets) and semi-hosted (CLI) systems simultaneously?

**Options**:

**A) Dual support** (RECOMMENDED for rollout)
- Keep droplet provisioning for existing customers
- New customers can choose semi-hosted
- Database distinguishes by: `IF ngrok_url IS NOT NULL THEN 'semi-hosted' ELSE 'fully-hosted'`
- Gradual migration path

**B) Hard cutover**
- Migrate all customers to semi-hosted at once
- Simpler codebase
- Higher risk, more disruptive

**C) Sunset droplets**
- Stop new droplet provisioning immediately
- Migrate existing customers over 3-6 months
- Decommission fully-hosted system after migration complete

**Recommendation**: Option A for initial rollout, then Option C for long-term

---

### 5. Platform Support Priority

**Question**: Which operating systems must we support in v1?

**Context**:
- macOS: Primary target (most developers)
- Linux: Easy to support (similar to macOS)
- Windows: Requires extra work (different paths, service management)

**Options**:

**A) macOS + Linux only**
- Faster to ship
- Cover 80%+ of target users
- Windows support in v2

**B) All three platforms (macOS, Linux, Windows)**
- Broader reach
- More testing and edge cases
- Longer development time

**Recommendation**: Option A (macOS + Linux) for v1, Windows support in v2

---

### 6. CLI Update Strategy

**Question**: How should CLI updates work?

**Options**:

**A) Manual npm update**
```bash
npm update -g @cyrus-ai/cli
```
- User controls when to update
- Simple, reliable
- Users may forget to update

**B) Auto-update on startup**
- CLI checks for updates when starting
- Downloads and applies automatically
- Can cause unexpected behavior

**C) Background updater service**
- Runs in background
- Updates when CLI is idle
- Most complex to implement

**D) Notification + prompt**
- CLI checks for updates
- Notifies user and asks permission
- Balance between automation and control

**Recommendation**: Option D (notification + prompt) for best UX

---

### 7. Multi-Repository Support

**Question**: Should one CLI instance support multiple repositories?

**Context**: Some users may want to run Cyrus on multiple repos from one machine.

**Options**:

**A) One CLI per repository**
- Each repo has its own ngrok tunnel
- Each repo has its own config-server port
- Simple, isolated

**B) One CLI for all repositories**
- Single ngrok tunnel
- Single config-server
- Manages multiple repo configurations
- More efficient

**Recommendation**: Option B (one CLI for all repos) for better resource usage

---

### 8. Health Monitoring

**Question**: Should Vercel actively monitor CLI health?

**Options**:

**A) Active monitoring**
- Vercel pings CLI health endpoint every 5 minutes
- Alerts user (email/dashboard) if offline
- Updates database: `cli_last_seen_at`
- Better visibility, more traffic

**B) Passive monitoring**
- Only check health when needed (e.g., webhook routing)
- Dashboard shows status on page load
- Less traffic, less visibility

**C) No monitoring**
- User responsible for keeping CLI running
- Simplest implementation

**Recommendation**: Option A (active monitoring) for better customer experience

---

### 9. Debugging & Support

**Question**: How will we debug issues on customer machines?

**Options**:

**A) Log upload feature**
- CLI command: `cyrus logs upload`
- Uploads `~/.cyrus/logs/` to Vercel
- Support can review logs
- Requires user action

**B) Remote diagnostics**
- Support can request diagnostic report
- CLI collects info (logs, config, system info)
- Sent to Vercel API
- Automated

**C) SSH access**
- Support requests SSH access
- User provides credentials
- Direct access to machine
- Security concerns

**Recommendation**: Option B (remote diagnostics) with user consent

---

### 10. Migration Path for Existing Customers

**Question**: How should we handle existing fully-hosted customers?

**Options**:

**A) Voluntary migration**
- Offer semi-hosted as option
- Customers can migrate when ready
- Continue billing for droplets until migration

**B) Forced migration**
- Set deadline (e.g., 3 months)
- All customers must migrate
- Offer support during migration
- Shut down droplets after deadline

**C) Grandfather existing customers**
- Existing customers stay on droplets forever
- New customers only get semi-hosted
- Maintain both systems indefinitely

**Recommendation**: Option A initially, transition to Option B after 6 months

---

## Additional Questions

### 11. Installation Instructions

**Question**: Where should users see their customer ID and installation instructions?

**Options**:
- A) After Stripe checkout (before GitHub App)
- B) In email after signup
- C) On dashboard page
- D) All of the above

**Recommendation**: Option A (right after checkout) with option D for reference

---

### 12. ngrok Alternative

**Question**: Should we support alternatives to ngrok (e.g., Cloudflare Tunnel, localtunnel)?

**Context**: Some users may prefer other tunneling solutions.

**Recommendation**: Start with ngrok only, add alternatives in v2 based on demand

---

### 13. Offline Mode

**Question**: Should CLI work when user's machine is offline (e.g., local development)?

**Context**: User may want to run Cyrus locally without webhooks.

**Recommendation**: Support offline mode where user manually triggers Cyrus on specific issues

---

### 14. Configuration UI

**Question**: Should we build a local web UI for configuration (in addition to Vercel app)?

**Context**: Advanced users may want to configure without going to Vercel.

**Options**:
- A) Web UI only (Vercel app)
- B) CLI commands only (`cyrus config set ...`)
- C) Local web UI (browser-based)
- D) TUI (terminal-based UI with `blessed` or similar)

**Recommendation**: Option A for v1, add Option B in v2

---

### 15. Pricing Strategy

**Question**: Should semi-hosted customers pay less than fully-hosted?

**Context**: We're saving $12-20/month per customer on infrastructure.

**Options**:
- A) Same price ($X/month)
- B) Lower price ($X - $5/month)
- C) Free tier for semi-hosted, paid for fully-hosted
- D) Credits/discount for bringing your own machine

**Recommendation**: Option D (offer discount or credits) to incentivize migration

---

## Security Questions

### 16. Secret Storage

**Question**: How should we store the CLI secret on user's machine?

**Options**:
- A) Plaintext in `~/.cyrus/onboarding.json` (chmod 600)
- B) Encrypted with user's system password
- C) Stored in OS keychain (macOS Keychain, Linux keyring)
- D) Environment variable

**Recommendation**: Option C (OS keychain) for best security

---

### 17. Token Refresh

**Question**: Should the CLI secret expire and require refresh?

**Options**:
- A) Never expires (permanent secret)
- B) Expires after X days (requires re-authentication)
- C) Expires when Stripe subscription lapses

**Recommendation**: Option C (tied to subscription status)

---

## Technical Questions

### 18. Config Server Port

**Question**: How should we allocate the config-server port?

**Options**:
- A) Random port (30000-40000)
- B) Fixed port (e.g., 3456)
- C) User-configurable via environment variable
- D) Next available port

**Recommendation**: Option A (random) with Option C (user override)

---

### 19. Process Management

**Question**: How should the CLI run in the background?

**Options**:
- A) Forever running process (user starts manually)
- B) System service (systemd on Linux, launchd on macOS)
- C) PM2 or similar process manager
- D) Screen/tmux session

**Recommendation**: Option B (system service) for reliability

---

### 20. Crash Recovery

**Question**: What happens if the config-server crashes during onboarding?

**Options**:
- A) User must restart `cyrus onboard`
- B) Auto-restart with state recovery
- C) Resume from last checkpoint

**Recommendation**: Option C (resume from checkpoint) for best UX

---

## Summary of Recommendations

**High Priority** (must decide before implementation):
1. ✅ Require ngrok paid tier
2. ✅ Use private npm package
3. ✅ Use proxy routing for webhooks
4. ✅ Support both fully-hosted and semi-hosted initially
5. ✅ macOS + Linux only for v1

**Medium Priority** (can decide during Phase 1):
6. ✅ Auto-update with notification + prompt
7. ✅ One CLI instance for all repositories
8. ✅ Active health monitoring
9. ✅ Remote diagnostics with user consent
10. ✅ Voluntary migration for existing customers

**Low Priority** (can decide later):
11-20. Various UX, security, and technical details

---

## Action Items

Before starting implementation, please confirm:

1. ✅ or ❌ on each high-priority recommendation
2. Any concerns or alternative suggestions
3. Timeline expectations
4. Resource allocation (developers, QA, etc.)

Once approved, I'll proceed with Phase 1 implementation plan.
