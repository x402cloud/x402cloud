# @x402cloud/facilitator

Facilitator core logic for verifying and settling x402 payments on-chain. Wraps `@x402cloud/evm` with viem clients and a private key for submitting settlement transactions.

## Install

```bash
npm install @x402cloud/facilitator
```

## Usage

```ts
import { createFacilitator } from "@x402cloud/facilitator";
import { baseSepolia } from "viem/chains";

const facilitator = createFacilitator({
  privateKey: process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`,
  rpcUrl: "https://sepolia.base.org",
  network: "eip155:84532",
  chain: baseSepolia,
});

// Verify a payment (no on-chain tx, just signature + balance checks)
const verification = await facilitator.verify(payload, requirements);
// { isValid: true, payer: "0x..." }

// Settle on-chain for actual usage
const settlement = await facilitator.settle(payload, requirements, "5000");
// { success: true, transaction: "0x...", network: "eip155:84532", settledAmount: "5000" }
```

### Using with an HTTP server

```ts
import { Hono } from "hono";

const app = new Hono();

app.post("/verify", async (c) => {
  const { payload, requirements } = await c.req.json();
  const result = await facilitator.verify(payload, requirements);
  return c.json(result);
});

app.post("/settle", async (c) => {
  const { payload, requirements, settlementAmount } = await c.req.json();
  const result = await facilitator.settle(payload, requirements, settlementAmount);
  return c.json(result);
});
```

## Configuration

```ts
type FacilitatorConfig = {
  privateKey: `0x${string}`;    // Pays gas for settlement transactions
  rpcUrl: string;                // RPC endpoint for the target chain
  network: Network;              // CAIP-2 identifier (e.g., "eip155:8453")
  chain: Chain;                  // viem Chain object
  ownAddress?: `0x${string}`;   // Optional: skip fees for own transactions
  feeBasisPoints?: number;       // Optional: fee for third-party settlements
};
```

## Exports

**Functions:** `createFacilitator`

**Types:** `FacilitatorConfig`, `Facilitator`

## Part of [x402cloud](https://github.com/x402cloud/x402cloud)
