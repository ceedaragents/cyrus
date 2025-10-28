# Cyrus Architecture Diagrams

## High-Level Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CYRUS MONOREPO                              │
├────────────────────────────────────┬────────────────────────────────┤
│                                    │                                │
│  APPS                              │  PACKAGES                      │
│  ════════════════════════════════  │  ═════════════════════════════ │
│                                    │                                │
│  ┌──────────────────┐              │  ┌──────────────────────────┐  │
│  │   CLI App        │              │  │ SharedApplicationServer  │  │
│  │  (apps/cli/)     │              │  │ (edge-worker/)           │  │
│  │                  │              │  │                          │  │
│  │ - Parse args     │              │  │ - HTTP server (3456)     │  │
│  │ - Load config    │              │  │ - ngrok tunnel           │  │
│  │ - Start worker   │              │  │ - Webhook routing        │  │
│  │ - OAuth flow     │◄─────────────┼─►│ - OAuth callback handler │  │
│  │ - CI/CD hooks    │              │  │ - Approval requests      │  │
│  └──────────────────┘              │  │ - HMAC/Linear signature  │  │
│                                    │  │   verification           │  │
│  ┌──────────────────┐              │  └──────────────────────────┘  │
│  │  Proxy Worker    │              │                                │
│  │ (apps/proxy/)    │              │  ┌──────────────────────────┐  │
│  │                  │              │  │    NdjsonClient          │  │
│  │ - OAuth endpoint │              │  │  (ndjson-client/)        │  │
│  │ - Webhook proxy  │              │  │                          │  │
│  │ - Token manager  │              │  │ - Proxy integration      │  │
│  │ - Config updates │              │  │ - HMAC signature verify  │  │
│  └──────────────────┘              │  │ - External server mode   │  │
│                                    │  │ - EdgeEvent stream       │  │
│                                    │  └──────────────────────────┘  │
│                                    │                                │
│                                    │  ┌──────────────────────────┐  │
│                                    │  │  LinearWebhookClient     │  │
│                                    │  │ (linear-webhook-client/) │  │
│                                    │  │                          │  │
│                                    │  │ - Direct webhooks        │  │
│                                    │  │ - Linear SDK integration │  │
│                                    │  │ - External server mode   │  │
│                                    │  │ - linear-signature check │  │
│                                    │  └──────────────────────────┘  │
│                                    │                                │
│                                    │  ┌──────────────────────────┐  │
│                                    │  │CloudflareTunnelClient    │  │
│                                    │  │(cloudflare-tunnel-client)│  │
│                                    │  │                          │  │
│                                    │  │ - Cloudflare tunnel      │  │
│                                    │  │ - Remote config mgmt     │  │
│                                    │  │ - Webhook distribution   │  │
│                                    │  └──────────────────────────┘  │
│                                    │                                │
│                                    │  ┌──────────────────────────┐  │
│                                    │  │    EdgeWorker            │  │
│                                    │  │  (edge-worker/)          │  │
│                                    │  │                          │  │
│                                    │  │ - Orchestration engine   │  │
│                                    │  │ - Client management      │  │
│                                    │  │ - Webhook routing        │  │
│                                    │  │ - Session management     │  │
│                                    │  │ - Claude runner          │  │
│                                    │  └──────────────────────────┘  │
│                                    │                                │
│                                    │  ┌──────────────────────────┐  │
│                                    │  │   Claude Runner          │  │
│                                    │  │   Core, Utilities        │  │
│                                    │  └──────────────────────────┘  │
└────────────────────────────────────┴────────────────────────────────┘
```

## Webhook Flow Architecture

```
LINEAR WEBHOOKS (Multiple Sources)
│
├─ Direct Webhooks (linear-signature header)
│  └─► POST /webhook ◄─────────────────────────────┐
│                                                   │
├─ Proxy Webhooks (x-webhook-signature header)     │
│  └─► POST /webhook ◄───────────────────────────┐ │
│                                                 │ │
└─ Cloudflare Tunnel (POST via tunnel)            │ │
   └─► POST /webhook ◄──────────────────────────┐ │ │
                                                │ │ │
                        ┌───────────────────────┴─┴─┴─────┐
                        │ SharedApplicationServer          │
                        │ /webhook Handler                 │
                        │                                  │
                        │ 1. Detect webhook type           │
                        │    (header-based)                │
                        │ 2. Route to handler              │
                        │ 3. Signature verification        │
                        └──────────────┬──────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
            ┌────────────────┐ ┌────────────────┐ ┌──────────────┐
            │ NdjsonClient   │ │LinearWebhook   │ │ EdgeWorker   │
            │ Handler        │ │ Client Handler │ │ handleWebhook│
            │                │ │                │ │              │
            │ Signature:     │ │ Signature:     │ │ Processes    │
            │ (body, sig,    │ │ (req, res)     │ │ Linear event │
            │  timestamp)    │ │                │ │              │
            │ => boolean     │ │ => Promise     │ │ Emits to     │
            │                │ │                │ │ handlers:    │
            │ Emits:         │ │ Emits:         │ │ - onIssue    │
            │ webhook event  │ │ webhook event  │ │ - onComment  │
            └────────┬───────┘ └────────┬───────┘ └──────────────┘
                     │                  │
                     └──────────────────┼────────────────────┐
                                        │                    │
                            ┌───────────▼──────────┐  ┌──────▼───────┐
                            │ Webhook Processing   │  │ Linear API   │
                            │                      │  │ Updates      │
                            │ - Parse Linear event │  │              │
                            │ - Get issue details  │  │ - Post       │
                            │ - Check assignment   │  │   comments   │
                            │ - Manage sessions    │  │ - Update     │
                            └──────┬───────────────┘  │   states     │
                                   │                  │ - Create     │
                            ┌──────▼──────────┐      │   issues     │
                            │ Claude Runner   │      └──────────────┘
                            │                │
                            │ - Execute tool │
                            │ - Generate     │
                            │   responses    │
                            └────────────────┘
```

## Request Flow for Webhook Registration

```
┌─────────────────────────────────────────────────────────────┐
│  Application Startup (EdgeWorker.start())                   │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────▼──────────┐
         │ SharedApplicationServer
         │ .start()
         │ - Create HTTP server on port 3456
         │ - Start ngrok tunnel
         │ - Emit ready event with tunnel URL
         └────┬──────────────┬──────────────┐
              │              │              │
       ┌──────▼──┐    ┌──────▼──┐    ┌─────▼─────┐
       │ FOR     │    │ FOR     │    │ FOR ALL   │
       │ EACH    │    │ EACH    │    │ REMAINING│
       │ TOKEN   │    │ REPO    │    │           │
       └──────┬──┘    └──────┬──┘    └─────┬─────┘
              │              │             │
        ┌─────▼────────┐     │             │
        │ Create Client│     │             │
        │ (NdjsonClient│     │             │
        │  OR Linear   │     │             │
        │  WebhookCl)  │     │             │
        └─────┬────────┘     │             │
              │              │             │
        ┌─────▼──────────────────────────┐
        │ client.connect()                │
        └─────┬──────────────────────────┘
              │
        ┌─────▼──────────────┐
        │ NdjsonClient Flow  │           LinearWebhookClient Flow
        │ (Proxy-based)      │           ─────────────────────────
        │                    │
        │ 1. registerWebhook()
        │    POST /edge/register
        │    to proxy with token
        │
        │ 2. Receive webhookSecret
        │
        │ 3. registerWithExtServer()
        │    .registerWebhookHandler(
        │      token,
        │      secret,
        │      (body, sig, time) => {
        │        verify HMAC
        │        return boolean
        │      }
        │    )
        │
        │ 4. SharedApplicationServer
        │    stores in
        │    webhookHandlers map
        │
        └─────┬──────────────┘
              │
        ┌─────▼──────────────┐
        │ INCOMING WEBHOOK   │
        │ POST /webhook      │
        │                    │
        │ 1. Detect header:  │
        │    x-webhook-sig   │
        │    (NdjsonClient)  │
        │                    │
        │ 2. Try each handler
        │    until one        │
        │    verifies sig     │
        │    and returns true │
        │                    │
        │ 3. Handler emits   │
        │    webhook event   │
        │                    │
        │ 4. EdgeWorker.on   │
        │    (webhook, data)│
        │    processes it     │
        └────────────────────┘
```

## Handler Call Stack

```
┌─────────────────────────────────────────────────────────────┐
│ INCOMING POST /webhook (Body: JSON webhook, Headers: sig)   │
└────────────┬────────────────────────────────────────────────┘
             │
    ┌────────▼──────────┐
    │ SharedApplication
    │ Server.handleRequest
    └────────┬───────────┘
             │
    ┌────────▼──────────────┐
    │ handleWebhookRequest()│
    │                       │
    │ - Check if Direct     │
    │   (linear-signature?) │
    │ - Check if Proxy      │
    │   (x-webhook-*)       │
    └────────┬──────────────┘
             │
       ┌─────┴─────┐
       │           │
   ┌───▼───┐   ┌───▼──────┐
   │Direct │   │Proxy     │
   │Mode   │   │Mode      │
   └───┬───┘   └───┬──────┘
       │           │
    ┌──▼──────┐ ┌─▼────────────────┐
    │ For each│ │For each handler  │
    │ linear  │ │in webhookHandlers│
    │ webhook │ │map:              │
    │ handler │ │                  │
    │ (req,   │ │ handler(body,    │
    │  res)   │ │   signature,     │
    │         │ │   timestamp)     │
    └────┬────┘ │                  │
         │      │ Returns boolean: │
    ┌────▼──┐   │ ┌─ true: Done!   │
    │Linear │   │ │ (emit event)   │
    │SDK    │   │ └─ false: Try    │
    │verifies   │   next handler   │
    │signature  │                  │
    │& handles  │ 500+ handlers    │
    │response   │ can co-exist     │
    └──────┘    └──────────────────┘
               │
        ┌──────▼────────┐
        │ Handler       │
        │ returns       │
        │ true/false    │
        │ (signature    │
        │  verified?)   │
        └──────┬────────┘
               │
        ┌──────▼────────────┐
        │ If true: respond  │
        │ 200 OK            │
        │ If false: try     │
        │ next handler      │
        │ If all fail:      │
        │ respond 401       │
        └────────────────────┘
```

## Data Flow: Token to Handler Registration

```
TOKEN LIFECYCLE
═══════════════════════════════════════════════════════════════════

┌────────────────────────────────────────────────────────────────┐
│ 1. Configuration                                               │
│                                                                │
│    config.json contains:                                       │
│    {                                                           │
│      repositories: [                                           │
│        {                                                       │
│          id: "repo-1",                                         │
│          linearToken: "linear_token_abc123"                   │
│        }                                                       │
│      ]                                                         │
│    }                                                           │
└────────────────────────────────────────────────────────────────┘
                            │
                    ┌───────▼──────────┐
                    │ EdgeWorker.      │
                    │ setupClients     │
                    │ ForTokens()      │
                    └───────┬──────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
        ┌───▼────────┐  ┌───▼────────┐ ┌───▼────────┐
        │ For token  │  │ For token  │ │For token N │
        │ 1 (abc123) │  │ 2 (def456) │ │(xyzABC)    │
        └───┬────────┘  └───┬────────┘ └───┬────────┘
            │               │              │
        ┌───▼──────────────────────────────────────┐
        │ Create NdjsonClient or LinearWebhookCl   │
        │ with config:                             │
        │  {                                       │
        │    token: "abc123",                      │
        │    externalWebhookServer:                │
        │      this.sharedApplicationServer,       │
        │    useExternalWebhookServer: true,       │
        │    ...                                   │
        │  }                                       │
        └───┬──────────────────────────────────────┘
            │
        ┌───▼────────────┐
        │ client.        │
        │ connect()      │
        │                │
        │ (if NdjsonCl)  │
        │ POST /edge/    │
        │ register to    │
        │ proxy with     │
        │ token=abc123   │
        │                │
        │ Response:      │
        │ {              │
        │  webhookSecret │
        │  : "sec_xyz"   │
        │ }              │
        └───┬────────────┘
            │
        ┌───▼────────────────────────────┐
        │ registerWithExtServer()         │
        │                                │
        │ Call SharedApplicationServer.  │
        │ registerWebhookHandler(        │
        │   "abc123",                    │
        │   "sec_xyz",                   │
        │   (body,sig,time) => {...}    │
        │ )                              │
        └───┬────────────────────────────┘
            │
        ┌───▼──────────────────────────────────┐
        │ SharedApplicationServer stores:      │
        │                                      │
        │ this.webhookHandlers.set(            │
        │   "abc123",                          │
        │   {                                  │
        │     secret: "sec_xyz",               │
        │     handler: (body,sig,time)=>{}    │
        │   }                                  │
        │ )                                    │
        │                                      │
        │ Map structure after all tokens:      │
        │ {                                    │
        │   "abc123" -> {...},                 │
        │   "def456" -> {...},                 │
        │   "xyzABC" -> {...}                  │
        │ }                                    │
        └────────────────────────────────────┘
                       │
                       │
        INCOMING WEBHOOK ARRIVES
        (from any token source)
                       │
        ┌──────────────▼──────────────┐
        │ POST /webhook               │
        │ Body: {"type": "issue", ...}│
        │ Headers: {                  │
        │   x-webhook-signature:      │
        │     sha256=abc123...,        │
        │   x-webhook-timestamp: 123  │
        │ }                           │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ handleWebhookRequest()      │
        │                             │
        │ for each handler in         │
        │ webhookHandlers             │
        │   result =                  │
        │     handler(body, sig, ts)  │
        │   if (result) {             │
        │     respond 200             │
        │     return                  │
        │   }                         │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ Handler matched!            │
        │ Signal verified!            │
        │                             │
        │ Emit webhook event:         │
        │ ndjsonClient.emit(          │
        │   "webhook",                │
        │   {data from body}          │
        │ )                           │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ EdgeWorker listening:       │
        │ client.on("webhook", (d)=>  │
        │   this.handleWebhook(d)     │
        │ )                           │
        │                             │
        │ Processes webhook           │
        │ based on type               │
        └─────────────────────────────┘
```

## Port and URL Resolution

```
PORT ASSIGNMENT FLOW
════════════════════════════════════════════════════════════════

Environment:
├─ CYRUS_SERVER_PORT=30135 (from .env)
├─ CYRUS_BASE_URL=undefined
└─ CYRUS_HOST_EXTERNAL=undefined

                   │
                   ▼
        ┌──────────────────┐
        │ parsePort(env)   │
        │ → 30135          │
        └──────────────────┘
                   │
                   ▼
        ┌──────────────────────────────┐
        │ SharedApplicationServer(     │
        │   port: 30135,               │
        │   host: "localhost"          │
        │ )                            │
        └──────────────┬───────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ server.listen(       │
            │   30135,             │
            │   "localhost"        │
            │ )                    │
            │                      │
            │ LISTENING:           │
            │ http://localhost:    │
            │ 30135                │
            └──────────┬───────────┘
                       │
        ┌──────────────┴────────────────┐
        │                               │
   ┌────▼─────────────┐     ┌──────────▼────────┐
   │ If NGROK_TOKEN   │     │ If CYRUS_HOST_    │
   │ provided AND     │     │ EXTERNAL=true     │
   │ NOT external     │     │                   │
   │ host             │     │ Use local URL:    │
   │                 │     │ http://localhost: │
   │ startNgrok      │     │ 30135              │
   │ Tunnel()         │     │                   │
   └────┬─────────────┘     └────────────────────┘
        │
   ┌────▼─────────────────────────────┐
   │ ngrok provides public URL:        │
   │ https://abc123.ngrok.io           │
   │                                   │
   │ Set env variable:                 │
   │ CYRUS_BASE_URL=                   │
   │   https://abc123.ngrok.io         │
   └────┬─────────────────────────────┘
        │
   ┌────▼──────────────────────────┐
   │ getBaseUrl() returns:          │
   │ - ngrokUrl if available        │
   │ - CYRUS_BASE_URL if set        │
   │ - local URL as fallback        │
   │                                │
   │ Returns for OAuth/webhooks:    │
   │ https://abc123.ngrok.io        │
   └────────────────────────────────┘

WEBHOOK URL REGISTRATION
════════════════════════════════════════════════════════════════

┌──────────────────────────────────────┐
│ NdjsonClient.connect()               │
│                                      │
│ Calls registerWebhook():             │
│ POST /edge/register                  │
│ to proxy with:                       │
│ {                                    │
│   webhookUrl:                        │
│     https://abc123.ngrok.io/webhook, │
│   linearToken: "token_abc123"        │
│ }                                    │
└────────────────────────────────────┘
```

## Complete Integration Example

```
STEP-BY-STEP WEBHOOK HANDLING EXAMPLE
════════════════════════════════════════════════════════════════

Token: "linear_abc123"
Repo: "my-repo"
Port: 30135
Ngrok URL: https://abc123.ngrok.io

INITIALIZATION:
1. EdgeWorker.start()
   └─> sharedApplicationServer.start()
       ├─> HTTP server listening on localhost:30135
       └─> Ngrok tunnel: https://abc123.ngrok.io

2. NdjsonClient.connect()
   ├─> registerWebhook()
   │   └─> POST /edge/register to proxy
   │       └─> Response: {webhookSecret: "secret_xyz"}
   │
   └─> registerWithExternalServer()
       └─> sharedApplicationServer.registerWebhookHandler(
           "linear_abc123",
           "secret_xyz",
           (body, sig, time) => {
             // Verify HMAC
             const expected = hmac(secret, time + '.' + body)
             return sig === expected
           }
         )

LINEAR WEBHOOK ARRIVES:
3. POST https://abc123.ngrok.io/webhook
   Headers:
     x-webhook-signature: sha256=abc123...
     x-webhook-timestamp: 1234567890
   Body: {"type": "issue.created", "data": {...}}

4. SharedApplicationServer.handleRequest()
   └─> handleWebhookRequest()
       ├─> Check for linear-signature header: NO
       ├─> Check for x-webhook-signature header: YES
       └─> This is PROXY-STYLE webhook
           └─> for each handler in webhookHandlers:
               ├─> Call handler for "linear_abc123"
               │   └─> Verify HMAC signature
               │   └─> Returns: TRUE
               │
               ├─> Handler verified signature!
               └─> Response: 200 OK

5. NdjsonClient emits webhook event
   └─> (ndjsonClient as NdjsonClient).on("webhook", (data) => {
         this.handleWebhook(data, [repo])
       })

6. EdgeWorker.handleWebhook(payload, repos)
   ├─> Parse webhook type: "issue.created"
   ├─> Get issue details
   ├─> Check if assigned to Cyrus
   └─> If yes:
       ├─> Create new Claude session
       ├─> Run Claude runner
       └─> Post response to Linear
```

