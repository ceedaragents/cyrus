# GitHub Token Endpoint

## Overview

The GitHub token endpoint provides a programmatic way to update the `gh` CLI authentication credentials used by Cyrus. This is particularly useful in CI/CD environments or automated deployment scenarios where you need to dynamically configure GitHub access.

## Enabling the Endpoint

The endpoint is **disabled by default** for security reasons. To enable it, set the `MANAGE_GH_AUTH` environment variable:

```bash
MANAGE_GH_AUTH=true cyrus start
```

When enabled, the endpoint will be available at:
```
http://localhost:3456/github-token
```

(The port may vary based on your `CYRUS_SERVER_PORT` configuration)

## Usage

### Making a Request

Send a POST request with a JSON body containing the GitHub token:

```bash
curl -X POST http://localhost:3456/github-token \
  -H "Content-Type: application/json" \
  -d '{"token": "ghp_YOUR_GITHUB_TOKEN"}'
```

### Request Format

**Method:** POST  
**Content-Type:** application/json  
**Body:**
```json
{
  "token": "ghp_YOUR_GITHUB_TOKEN"
}
```

### Response

**Success (200 OK):**
```json
{
  "success": true,
  "message": "GitHub auth credentials updated successfully"
}
```

**Error (400 Bad Request):**
```json
{
  "error": "Missing token in request body"
}
```

**Error (500 Internal Server Error):**
```json
{
  "error": "Failed to update GitHub auth credentials",
  "details": "Error message details"
}
```

## Security Considerations

1. **Disabled by Default:** The endpoint is only active when explicitly enabled via `MANAGE_GH_AUTH=true`
2. **Local Only:** By default, the server listens on localhost, reducing exposure
3. **Token Security:** Ensure GitHub tokens are transmitted securely (use HTTPS in production)
4. **Limited Scope:** Use GitHub tokens with minimal required permissions

## Example Test Script

A test script is provided at `test-github-token-endpoint.js`:

```javascript
node test-github-token-endpoint.js ghp_YOUR_GITHUB_TOKEN
```

## Integration Examples

### CI/CD Pipeline

```yaml
# GitHub Actions example
- name: Configure Cyrus GitHub Auth
  run: |
    curl -X POST http://cyrus-server:3456/github-token \
      -H "Content-Type: application/json" \
      -d "{\"token\": \"${{ secrets.GITHUB_TOKEN }}\"}"
```

### Docker Compose

```yaml
services:
  cyrus:
    image: cyrus-ai
    environment:
      - MANAGE_GH_AUTH=true
      - CYRUS_SERVER_PORT=3456
    ports:
      - "3456:3456"
```

## Troubleshooting

1. **Endpoint returns 404:** Ensure `MANAGE_GH_AUTH=true` is set when starting Cyrus
2. **Authentication fails:** Verify the GitHub token has appropriate permissions
3. **Connection refused:** Check that the server is running and the port is correct