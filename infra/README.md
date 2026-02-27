# Cyrus AWS Infrastructure

AWS CDK infrastructure for deploying Cyrus as a containerized service on ECS Fargate.

## Architecture

```
                    ┌─────────────┐
  Linear Webhooks → │     ALB     │ (public, internet-facing)
                    │  :80 / :443 │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Fargate   │ (private subnet)
                    │  Cyrus Task │ :3456
                    │  2 vCPU/4GB │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼────┐  ┌──────▼──────┐
     │     EFS     │ │ Secrets │  │     ECR     │
     │  /cyrus-data│ │ Manager │  │ cyrus:latest│
     └─────────────┘ └─────────┘  └─────────────┘
```

**Key components:**

- **ECS Fargate** — single task (Cyrus is stateful: in-memory sessions + filesystem worktrees)
- **EFS** — persistent storage mounted at `/home/cyrus/.cyrus` for repos, worktrees, and config
- **ALB** — internet-facing load balancer receiving Linear webhooks
- **Secrets Manager** — stores Linear OAuth credentials and Anthropic API key
- **ECR** — private Docker image registry

## Stacks

| Stack | Description |
|-------|-------------|
| `CyrusVpc` | VPC with 2 AZs, public + private subnets, 1 NAT gateway |
| `CyrusService` | ECS cluster, Fargate task, EFS, ALB, ECR, Secrets Manager |

## Prerequisites

- AWS CLI configured with credentials
- Node.js 20+
- Docker (for building the container image)

## Quick Start

### 1. Install dependencies

```bash
cd infra
npm install
```

### 2. Synthesize CloudFormation templates

```bash
npx cdk synth
```

### 3. Deploy the stacks

```bash
npx cdk deploy --all
```

After deployment, note the outputs:
- **AlbDnsName** — configure this as your Linear webhook URL
- **EcrRepositoryUri** — push your Docker image here
- **SecretsArn** — update with your real credentials

### 4. Update secrets

Replace placeholder values in Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id cyrus/config \
  --secret-string '{
    "LINEAR_CLIENT_ID": "your-client-id",
    "LINEAR_CLIENT_SECRET": "your-client-secret",
    "LINEAR_WEBHOOK_SECRET": "your-webhook-secret",
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }'
```

### 5. Build and push the Docker image

```bash
# From monorepo root
docker build -t cyrus:latest .

# Authenticate with ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ECR_URI>

# Tag and push
docker tag cyrus:latest <ECR_URI>:latest
docker push <ECR_URI>:latest
```

### 6. Force a new deployment

```bash
aws ecs update-service --cluster cyrus --service <service-name> --force-new-deployment
```

## HTTPS Setup (Optional)

To enable HTTPS, provide a certificate ARN and domain name via CDK context:

```bash
npx cdk deploy --all \
  -c certificateArn=arn:aws:acm:us-east-1:123456789:certificate/abc-123 \
  -c domainName=cyrus.example.com
```

This will:
- Add an HTTPS listener on port 443
- Redirect all HTTP traffic to HTTPS
- Use the provided ACM certificate

You'll also need to create a CNAME/A record pointing your domain to the ALB DNS name.

## Verification

After deployment, verify the service is healthy:

```bash
# Check the ALB health endpoint
curl http://<ALB_DNS>/status
# Expected: {"status":"idle"}

# Check ECS service status
aws ecs describe-services --cluster cyrus --services <service-name>

# View container logs
aws logs tail /ecs/cyrus --follow

# ECS Exec into the running container
aws ecs execute-command --cluster cyrus --task <task-id> \
  --container cyrus --interactive --command /bin/bash
```

## Design Decisions

- **Single instance (`desiredCount: 1`)** — Cyrus is stateful with in-memory session maps and filesystem-bound git worktrees. Horizontal scaling requires architectural changes.
- **EFS over EBS** — Fargate doesn't support EBS volumes; EFS is the only persistent storage option.
- **UID 1000 alignment** — The Dockerfile creates a `cyrus` user with UID 1000, and the EFS access point enforces the same UID/GID. This ensures file permissions work correctly.
- **`CYRUS_HOST_EXTERNAL=true`** — Required so Fastify binds to `0.0.0.0` instead of `localhost`, allowing the ALB to reach the container.
- **No Cloudflare tunnel** — The ALB replaces it for webhook ingress. The tunnel only activates when `CLOUDFLARE_TOKEN` is set (which is not provided here).
- **ECS Exec enabled** — Allows `aws ecs execute-command` for debugging running containers.
