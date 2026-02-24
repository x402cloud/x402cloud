# x402cloud

Open-source x402 payment infrastructure for the agent economy.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What is x402cloud?

x402cloud is a complete implementation of the [x402 protocol](https://www.x402.org/) -- HTTP-native micropayments using USDC and Permit2. Agents pay for APIs the same way browsers load web pages: transparently, per-request, with no signup or API keys.

```
Agent  -->  POST /api (no payment)
Server -->  402 Payment Required (scheme, amount, payTo)
Agent  -->  Signs Permit2 authorization
Agent  -->  POST /api + PAYMENT-SIGNATURE header
Server -->  Verify -> Execute -> Meter -> Settle on-chain
Server -->  200 OK + X-Payment-Settled header
```

## Quick Start

**Server** -- accept payments with one middleware:

```ts
import { Hono } from "hono";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";

const app = new Hono();

app.use("*", remoteUptoPaymentMiddleware(
  {
    "POST /v1/chat/completions": {
      network: "eip155:8453",
      maxPrice: "$0.01",
      payTo: "0xYourAddress",
      meter: async () => "5000", // actual cost in USDC units
    },
  },
  "https://facilitator.x402cloud.ai",
));

app.post("/v1/chat/completions", (c) => c.json({ message: "hello" }));
```

**Client** -- auto-pay 402 responses:

```ts
import { wrapFetchWithPayment } from "@x402cloud/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const account = privateKeyToAccount("0xYourPrivateKey");
const wallet = createWalletClient({ account, chain: base, transport: http() });

const payingFetch = wrapFetchWithPayment({
  signer: { address: account.address, signTypedData: (p) => wallet.signTypedData(p) },
});

const res = await payingFetch("https://api.example.com/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
});
```

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@x402cloud/protocol`](packages/protocol) | Types, headers, encoding (zero deps) | `npm i @x402cloud/protocol` |
| [`@x402cloud/evm`](packages/evm) | EVM payment schemes (exact + upto) | `npm i @x402cloud/evm` |
| [`@x402cloud/client`](packages/client) | Auto-pay 402 responses | `npm i @x402cloud/client` |
| [`@x402cloud/middleware`](packages/middleware) | Server middleware (Hono) | `npm i @x402cloud/middleware` |
| [`@x402cloud/facilitator`](packages/facilitator) | Verify + settle payments | `npm i @x402cloud/facilitator` |

## Architecture

```
@x402cloud/protocol       <-- zero deps, types + encode/decode
       |
@x402cloud/evm            <-- protocol + viem
       |
  +----+----+-----------+
  |         |           |
client   middleware  facilitator
```

- **protocol** is the base layer -- pure types and header encoding, zero dependencies
- **evm** implements Permit2-based payment schemes for any EVM chain
- **client**, **middleware**, and **facilitator** compose protocol + evm for their roles

## Live Services

| Service | URL | Description |
|---------|-----|-------------|
| Inference API | [infer.x402cloud.ai](https://infer.x402cloud.ai) | Pay-per-call AI inference (OpenAI-compatible) |
| Facilitator | [facilitator.x402cloud.ai](https://facilitator.x402cloud.ai) | Payment verification and settlement |

## How x402 Works

1. **Client requests** a paid endpoint without payment
2. **Server responds** with `402 Payment Required` including price, network, and payment address
3. **Client signs** a Permit2 authorization for up to the max amount (no on-chain tx)
4. **Client retries** with the `PAYMENT-SIGNATURE` header
5. **Server verifies** the signature, executes the request, meters usage, and settles on-chain for the actual cost

Settlement uses [Uniswap Permit2](https://github.com/Uniswap/permit2) -- the client authorizes up to a max, and the server settles for only what was consumed.

## Supported Networks

Any EVM chain with Permit2 and USDC. Built-in addresses for:

Base, Ethereum, Optimism, Polygon, Arbitrum, Avalanche (+ testnets)

## Development

```bash
pnpm install        # install all dependencies
pnpm build          # build all packages (topological order)
pnpm test           # run all unit tests
```

Run a single package:

```bash
pnpm -F @x402cloud/evm test
pnpm -F @x402cloud/middleware test
```

E2E tests (requires Base Sepolia USDC):

```bash
pnpm -F e2e-tests test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
