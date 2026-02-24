# Self-Hosted x402 Facilitator

Run your own x402 payment facilitator. Verifies and settles USDC micropayments on-chain via Permit2.

## Quick Start

```bash
docker run \
  -e FACILITATOR_PRIVATE_KEY=0x... \
  -e RPC_URL=https://mainnet.base.org \
  -e NETWORK=eip155:8453 \
  -p 3000:3000 \
  ghcr.io/x402cloud/facilitator
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FACILITATOR_PRIVATE_KEY` | Yes | — | Private key for settlement transactions (pays gas) |
| `RPC_URL` | Yes | — | RPC endpoint for the target chain |
| `NETWORK` | No | `eip155:8453` | CAIP-2 network ID (`eip155:8453` = Base, `eip155:84532` = Base Sepolia) |
| `PORT` | No | `3000` | HTTP port |
| `FACILITATOR_API_TOKEN` | No | — | Bearer token for /verify and /settle (disabled if unset) |

## Build from Source

```bash
# From the x402cloud repo root
docker build -f apps/facilitator-docker/Dockerfile -t x402cloud-facilitator .
docker run --env-file apps/facilitator-docker/.env -p 3000:3000 x402cloud-facilitator
```

## Use with Your Server

Point your x402 middleware at your self-hosted facilitator:

```typescript
import { remoteExactPaymentMiddleware } from "@x402cloud/middleware";

app.use("/*", remoteExactPaymentMiddleware(routes, "http://localhost:3000"));
```

## Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | No | Service info |
| `/health` | GET | No | Health check |
| `/supported` | GET | No | Supported schemes + networks |
| `/verify` | POST | Optional | Verify upto payment |
| `/settle` | POST | Optional | Settle upto payment on-chain |
| `/verify-exact` | POST | Optional | Verify exact payment |
| `/settle-exact` | POST | Optional | Settle exact payment on-chain |
