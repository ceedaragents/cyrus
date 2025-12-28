# Cloudflare Tunnel Setup (Optional)

This guide covers setting up a Cloudflare Tunnel to expose your local Cyrus instance to the public internet for receiving Linear webhooks.

> **Note:** This is one option for exposing your Cyrus instance. Other options include ngrok, a reverse proxy with a public domain, or a server with a public IP. See [Self-Hosting Guide](./SELF_HOSTING.md) for alternatives.

---

## Prerequisites

- A Cloudflare account (free tier works)
- Your own domain added to Cloudflare (required for permanent tunnels)

> **Note:** Free `trycloudflare.com` URLs are only for temporary quick tunnels and change on restart.

---

## Step 1: Create Cloudflare Account (if needed)

1. Go to https://cloudflare.com
2. Click **Sign up**
3. Create free account
4. Verify email

---

## Step 2: Create Cloudflare Tunnel

1. **Log in to Cloudflare Dashboard:**
   - Go to https://one.dash.cloudflare.com/

2. **Navigate to Tunnels:**
   - In left sidebar: Click **Access**
   - Then click **Tunnels**

3. **Create New Tunnel:**
   - Click **Create a tunnel**
   - Name it: `cyrus-local`
   - Click **Save tunnel**

4. **Copy Tunnel Token:**
   - You'll see a long token starting with `eyJ...`
   - Click **Copy** or select and copy the entire token
   - **SAVE THIS** - you'll need it for environment variables

5. **Configure Public Hostname:**
   - Click **Next** or go to tunnel settings
   - Click **Public Hostname** tab
   - Click **Add a public hostname**

   Fill in:
   - **Subdomain:** `cyrus` (or whatever you want)
   - **Domain:** Select your domain from dropdown
   - **Path:** Leave empty
   - **Type:** HTTP
   - **URL:** `localhost:3456`

6. **Save Hostname:**
   - Click **Save hostname**
   - **Copy the full public URL** (e.g., `https://cyrus.yourdomain.com`)
   - **SAVE THIS** - this is your `CYRUS_BASE_URL`

---

## Step 3: Configure Environment Variables

Set these environment variables for Cloudflare Tunnel integration:

```bash
export CYRUS_BASE_URL=https://cyrus.yourdomain.com
export CYRUS_SERVER_PORT=3456
export CLOUDFLARE_TOKEN=eyJhIjoiXXXXXXX...your_token_here...XXXXXXX
```

Cyrus will automatically start the Cloudflare tunnel in the background when it detects the `CLOUDFLARE_TOKEN` environment variable.

---

## Troubleshooting

### Tunnel Not Starting

- Verify `CLOUDFLARE_TOKEN` is set correctly
- Check Cyrus logs for tunnel-related errors
- Ensure the token hasn't expired in Cloudflare dashboard

### Webhooks Not Received

- Verify the public hostname is configured correctly in Cloudflare
- Check that `CYRUS_BASE_URL` matches your Cloudflare hostname exactly
- Ensure Linear webhook URL uses the same base URL

---

## Alternative: Quick Tunnel (Development Only)

For quick testing without a domain, you can use Cloudflare's quick tunnel feature, but note that the URL changes on each restart:

```bash
# This is not recommended for production use
cloudflared tunnel --url http://localhost:3456
```

For production self-hosting, use a permanent tunnel with your own domain.
