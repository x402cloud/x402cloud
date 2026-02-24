# @x402cloud/middleware

Server middleware for accepting x402 payments. Plugs into Hono with one function call. Supports both local signing (your own facilitator) and remote facilitation (via facilitator.x402cloud.ai).

## Install

```bash
npm install @x402cloud/middleware
```

## Usage

### Remote facilitator (recommended for most apps)

Use a hosted facilitator for verification and settlement. No private keys on your server.

```ts
import { Hono } from "hono";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";

const app = new Hono();

app.use("*", remoteUptoPaymentMiddleware(
  {
    "POST /v1/chat/completions": {
      network: "eip155:8453",    // Base mainnet
      maxPrice: "$0.01",         // Max USDC per request
      payTo: "0xYourAddress",    // Your wallet
      meter: async ({ response }) => {
        // Return actual cost in USDC smallest units
        return "5000"; // $0.005
      },
    },
  },
  "https://facilitator.x402cloud.ai",
));

app.post("/v1/chat/completions", (c) => c.json({ message: "hello" }));
```

### Local facilitator (self-hosted)

Run your own facilitator with a private key for direct on-chain settlement.

```ts
import { uptoPaymentMiddleware } from "@x402cloud/middleware";
import type { FacilitatorSigner } from "@x402cloud/evm";

// Build a FacilitatorSigner from viem (see @x402cloud/facilitator)
const signer: FacilitatorSigner = { /* ... */ };

app.use("*", uptoPaymentMiddleware(
  {
    "POST /api/generate": {
      network: "eip155:8453",
      maxPrice: "$0.05",
      payTo: "0xYourAddress",
      meter: async () => "25000",
    },
  },
  signer,
));
```

### Custom verify/settle (advanced)

Build your own middleware with injected verify and settle functions.

```ts
import { buildUptoMiddleware } from "@x402cloud/middleware";
import type { VerifyFn, SettleFn } from "@x402cloud/middleware";

const verify: VerifyFn = async (payload, requirements) => {
  // Custom verification logic
  return { isValid: true, payer: payload.permit2Authorization.from };
};

const settle: SettleFn = async (payload, requirements, amount) => {
  // Custom settlement logic
};

app.use("*", buildUptoMiddleware(routes, verify, settle));
```

## Route configuration

Routes are keyed by `"METHOD /path"`:

```ts
const routes: UptoRoutesConfig = {
  "POST /v1/chat/completions": {
    network: "eip155:8453",       // CAIP-2 network
    maxPrice: "$0.01",            // Max price in USDC
    payTo: "0xYourAddress",       // Settlement address
    asset: "0x...",               // Optional: USDC address (auto-detected)
    maxTimeoutSeconds: 300,       // Optional: payment deadline (default: 300)
    description: "AI inference",  // Optional: shown to client
    meter: async (ctx) => "5000", // Required: actual cost after execution
  },
};
```

## Exports

**Functions:** `buildUptoMiddleware`, `uptoPaymentMiddleware`, `remoteUptoPaymentMiddleware`, `buildPaymentRequired`

**Types:** `VerifyFn`, `SettleFn`, `UptoRouteConfig`, `UptoRoutesConfig`

## Part of [x402cloud](https://github.com/x402cloud/x402cloud)
