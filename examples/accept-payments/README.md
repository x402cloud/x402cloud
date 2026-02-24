# Accept Payments

Server-side example showing how to add x402 micropayments to a Hono API using `@x402cloud/middleware`.

## What it does

- Defines two paid endpoints (`/api/premium` and `/api/generate`) with per-route pricing
- Uses `remoteUptoPaymentMiddleware` to delegate payment verification to a remote facilitator (no private keys needed on the server)
- Demonstrates flat-rate and usage-based metering

## How it works

1. Client sends a request without payment -> gets `402 Payment Required` with pricing details
2. Client signs a payment authorization and retries with a `PAYMENT-SIGNATURE` header
3. Middleware verifies the payment via the facilitator, runs the handler, then settles for actual usage

## Key concepts

- **`paidRoutes`** — map URL paths to pricing config (network, maxPrice, payTo, meter function)
- **`meter`** — called after the response is generated to compute the actual charge (can be less than maxPrice)
- **`remoteUptoPaymentMiddleware`** — stateless middleware that calls a remote facilitator for verify/settle
