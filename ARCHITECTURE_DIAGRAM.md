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
│  │                  │              │  │ LinearEventTransport     │  │
│  │ - OAuth endpoint │              │  │(linear-event-transport/) │  │
│  │ - Webhook proxy  │              │  │                          │  │
│  │ - Token manager  │              │  │ - Direct webhooks        │  │
│  │ - Config updates │              │  │ - Linear SDK HMAC verify │  │
│  └──────────────────┘              │  │ - Webhook registration   │  │
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
├─ ngrok Tunnel Webhooks                           │
│  └─► POST /webhook ◄───────────────────────────┐ │
│                                                 │ │
└─ Cloudflare Tunnel (POST via tunnel)            │ │
   └─► POST /webhook ◄──────────────────────────┐ │ │
                                                │ │ │
                        ┌───────────────────────┴─┴─┴─────┐
                        │ SharedApplicationServer          │
                        │ /webhook Handler                 │
                        │                                  │
                        │ 1. Route to handler              │
                        │ 2. HMAC signature verification   │
                        └──────────────┬──────────────────┘
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │ LinearEventTransport │
                            │ Handler              │
                            │                      │
                            │ Signature:           │
                            │ (req, res)           │
                            │ => Promise           │
                            │                      │
                            │ Emits:               │
                            │ webhook event        │
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼──────────┐
                            │ EdgeWorker          │
                            │ handleWebhook       │
                            │                     │
                            │ - Parse Linear      │
                            │   event             │
                            │ - Get issue details │
                            │ - Check assignment  │
                            │ - Manage sessions   │
                            └──────┬──────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
             ┌──────▼───────┐ ┌───▼────────┐ ┌──▼──────────┐
             │ Claude Runner│ │ Linear API │ │ Linear      │
             │              │ │ Updates    │ │ Comments    │
             │ - Execute    │ │            │ │             │
             │   tool       │ │ - Post     │ │ - Post      │
             │ - Generate   │ │   comments │ │   status    │
             │   responses  │ │ - Update   │ │   updates   │
             └──────────────┘ │   states   │ └─────────────┘
                              │ - Create   │
                              │   issues   │
                              └────────────┘
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
         └────┬──────────────────┘
              │
       ┌──────▼──────┐
       │ FOR EACH    │
       │ TOKEN/REPO  │
       └──────┬──────┘
              │
        ┌─────▼────────────┐
        │ Create           │
        │ LinearEvent      │
        │ Transport        │
        └─────┬────────────┘
              │
        ┌─────▼──────────────────────────┐
        │ transport.connect()             │
        │                                 │
        │ 1. Register webhook with Linear │
        │    using Linear SDK             │
        │                                 │
        │ 2. Register handler with        │
        │    SharedApplicationServer      │
        │    .registerLinearHandler()     │
        │                                 │
        │ 3. Handler receives (req, res)  │
        │    and verifies Linear SDK      │
        │    signature                    │
        └─────┬───────────────────────────┘
              │
        ┌─────▼──────────────┐
        │ INCOMING WEBHOOK   │
        │ POST /webhook      │
        │                    │
        │ 1. Detect header:  │
        │    linear-signature│
        │                    │
        │ 2. Route to Linear │
        │    handler         │
        │                    │
        │ 3. Handler verifies│
        │    signature via   │
        │    Linear SDK      │
        │                    │
        │ 4. Handler emits   │
        │    webhook event   │
        │                    │
        │ 5. EdgeWorker.on   │
        │    (webhook, data) │
        │    processes it    │
        └────────────────────┘
```

## Handler Call Stack

```
┌─────────────────────────────────────────────────────────────┐
│ INCOMING POST /webhook (Body: JSON webhook, Headers: sig)   │
└────────────┬────────────────────────────────────────────────┘
             │
    ┌────────▼──────────┐
    │ SharedApplication │
    │ Server.handleRequest
    └────────┬───────────┘
             │
    ┌────────▼──────────────┐
    │ handleWebhookRequest()│
    │                       │
    │ - Check for           │
    │   linear-signature    │
    │   header              │
    └────────┬──────────────┘
             │
             ▼
    ┌────────────────────┐
    │ For each Linear    │
    │ webhook handler:   │
    │                    │
    │ handler(req, res)  │
    │                    │
    │ - Linear SDK       │
    │   verifies HMAC    │
    │   signature        │
    │                    │
    │ - Parses webhook   │
    │   payload          │
    │                    │
    │ - Emits webhook    │
    │   event to         │
    │   EdgeWorker       │
    │                    │
    │ - Responds 200 OK  │
    └────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │ EdgeWorker         │
    │ handleWebhook()    │
    │                    │
    │ - Parse event type │
    │ - Get issue details│
    │ - Check assignment │
    │ - Manage sessions  │
    │ - Run Claude       │
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
        ┌───▼─────────────────────────────────┐
        │ Create LinearEventTransport         │
        │ with config:                        │
        │  {                                  │
        │    token: "abc123",                 │
        │    linearClient: LinearClient,      │
        │    externalWebhookServer:           │
        │      this.sharedApplicationServer,  │
        │    webhookUrl: baseUrl + '/webhook',│
        │  }                                  │
        └───┬─────────────────────────────────┘
            │
        ┌───▼────────────────────────────┐
        │ transport.connect()             │
        │                                 │
        │ 1. Register webhook with Linear │
        │    via Linear SDK:              │
        │    linearClient.createWebhook({ │
        │      url: webhookUrl,           │
        │      resourceTypes: [...],      │
        │    })                           │
        │                                 │
        │ 2. Linear responds with webhook │
        │    ID and signing secret        │
        └───┬─────────────────────────────┘
            │
        ┌───▼───────────────────────────────┐
        │ registerLinearHandler()            │
        │                                    │
        │ Call SharedApplicationServer.      │
        │ registerLinearHandler(             │
        │   handler: (req, res) => {         │
        │     // Verify Linear signature     │
        │     // Parse webhook payload       │
        │     // Emit to EdgeWorker          │
        │   }                                │
        │ )                                  │
        └───┬────────────────────────────────┘
            │
        ┌───▼──────────────────────────────────┐
        │ SharedApplicationServer stores:      │
        │                                      │
        │ this.linearWebhookHandlers.push(     │
        │   (req, res) => {                    │
        │     // Linear SDK verification       │
        │     // Event emission                │
        │   }                                  │
        │ )                                    │
        │                                      │
        │ Array of handlers for all tokens     │
        └──────────────────────────────────────┘
                       │
                       │
        INCOMING WEBHOOK ARRIVES
        (from Linear)
                       │
        ┌──────────────▼──────────────┐
        │ POST /webhook               │
        │ Body: {"type": "issue", ...}│
        │ Headers: {                  │
        │   linear-signature:         │
        │     t=timestamp,v1=hash     │
        │ }                           │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ handleWebhookRequest()      │
        │                             │
        │ Detect linear-signature     │
        │ header present              │
        │                             │
        │ for each handler in         │
        │ linearWebhookHandlers:      │
        │   handler(req, res)         │
        │                             │
        │ Handler uses Linear SDK     │
        │ to verify signature         │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ Handler verified signature  │
        │                             │
        │ Emit webhook event:         │
        │ transport.emit(             │
        │   "webhook",                │
        │   {data from body}          │
        │ )                           │
        │                             │
        │ Respond 200 OK              │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ EdgeWorker listening:       │
        │ transport.on("webhook",     │
        │   (data) => {               │
        │     this.handleWebhook(data)│
        │   }                         │
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
│ LinearEventTransport.connect()       │
│                                      │
│ Registers webhook directly with      │
│ Linear via Linear SDK:               │
│ {                                    │
│   url:                               │
│     https://abc123.ngrok.io/webhook, │
│   resourceTypes: ["Issue",           │
│     "Comment", "IssueLabel"]         │
│ }                                    │
│                                      │
│ Linear responds with webhook ID      │
│ and signing secret for HMAC          │
│ verification                         │
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

2. LinearEventTransport.connect()
   ├─> Register webhook with Linear SDK
   │   └─> linearClient.createWebhook({
   │         url: "https://abc123.ngrok.io/webhook",
   │         resourceTypes: ["Issue", "Comment", "IssueLabel"]
   │       })
   │   └─> Response: {id: "webhook_xyz", secret: "signing_secret"}
   │
   └─> registerLinearHandler()
       └─> sharedApplicationServer.registerLinearHandler(
           (req, res) => {
             // Parse Linear webhook signature header
             const signature = req.headers['linear-signature']

             // Verify signature using Linear SDK
             if (linearClient.verifyWebhookSignature(
               req.body,
               signature,
               secret
             )) {
               // Emit webhook event to EdgeWorker
               transport.emit("webhook", req.body)
               res.status(200).send("OK")
             } else {
               // Signature verification failed
               // Continue to next handler
             }
           }
         )

LINEAR WEBHOOK ARRIVES:
3. POST https://abc123.ngrok.io/webhook
   Headers:
     linear-signature: t=1234567890,v1=abc123...
   Body: {"action": "create", "type": "Issue", "data": {...}}

4. SharedApplicationServer.handleRequest()
   └─> handleWebhookRequest()
       ├─> Detect linear-signature header: YES
       └─> This is LINEAR DIRECT webhook
           └─> for each handler in linearWebhookHandlers:
               ├─> Call handler(req, res)
               │   └─> Verify Linear SDK signature
               │   └─> Emit webhook event
               │   └─> Respond 200 OK
               │
               └─> Handler verified signature!

5. LinearEventTransport emits webhook event
   └─> transport.emit("webhook", webhookPayload)

6. EdgeWorker receives webhook event
   └─> transport.on("webhook", (data) => {
         this.handleWebhook(data, [repo])
       })

7. EdgeWorker.handleWebhook(payload, repos)
   ├─> Parse webhook type: "Issue"
   ├─> Parse webhook action: "create"
   ├─> Get issue details
   ├─> Check if assigned to Cyrus
   └─> If yes:
       ├─> Create new Claude session
       ├─> Run Claude runner
       └─> Post response to Linear
```

