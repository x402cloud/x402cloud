# @x402cloud/facilitator

Facilitator core logic for verifying and settling x402 payments on-chain. Wraps `@x402cloud/evm` with viem clients and a private key for submitting settlement transactions, plus ready-made Hono routes.

## Install

```bash
pnpm add @x402cloud/facilitator
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

// Verify a payment (no on-chain tx, just signature checks)
const verification = await facilitator.verify(payload, requirements);
// { isValid: true, payer: "0x..." }

// Settle on-chain for actual usage
const settlement = await facilitator.settle(payload, requirements, "5000");
// { success: true, transaction: "0x...", network: "eip155:84532", settledAmount: "5000" }

// Confirm an ALREADY-BROADCAST settlement tx (durable retry path — never re-broadcasts)
const confirmed = await facilitator.confirm(txHash, "eip155:84532", "5000");
```

Exact-scheme payments use `facilitator.verifyExact(payload, requirements)` and `facilitator.settleExact(payload, requirements)` (settles the full authorized amount). New schemes plug into the `facilitator.schemes` map.

### HTTP routes (Hono)

`createFacilitatorRoutes` returns a Hono app with `/verify`, `/settle`, `/verify-exact`, `/settle-exact`, and `/fee?scheme=upto|exact` (public, unauthenticated — a price quote, like `/supported`):

```ts
import { Hono } from "hono";
import { createFacilitator, createFacilitatorRoutes } from "@x402cloud/facilitator";
import { bearerAuth } from "hono/bearer-auth";

const app = new Hono();
app.route("/", createFacilitatorRoutes(
  () => facilitator,                                  // lazy getter (Workers-friendly)
  { auth: bearerAuth({ token: process.env.TOKEN! }) }, // bound directly to payment routes
));
```

### Computed settlement-fee floor (workspace#45)

Every settle costs real gas, paid by this facilitator's wallet. `estimateFee`
computes a fee floor from live chain data — measured gas units, live
base+priority fee, Base's L1 data fee, and a live Chainlink ETH/USD read —
and fails closed (a conservative upper-bound estimate, never a guess that
could under-charge) if any of those reads fails:

```ts
const fee = await facilitator.estimateFee!("upto"); // { microUsdc: "842", degraded: false }
```

It also rides on `verify`/`verifyExact` automatically (`settlementFee`,
`feeDegraded` on a valid `VerifyResponse`) and backs the `/fee` route (below)
— most callers never call `estimateFee` directly. Pair it with
`@x402cloud/middleware`'s `retailPrice(wholesale, authorized, marginBps,
feeFloor)` so the marketplace's take is `max(percentage margin, this fee)`,
never a hardcoded per-call fee. Set `ethUsdFeedAddress` in
`FacilitatorConfig` to a verified Chainlink feed address for your network —
omitting it is safe (the fee floor just always uses the fail-closed
fallback for that leg) but means quotes are always degraded.

### Settlement classification

Helpers for durable retry logic — decide whether a failed settlement is safe to retry:

```ts
import { classifySettlement, isTransientFailure, pendingReceiptTxHash } from "@x402cloud/facilitator";

const cls = classifySettlement(settleResponse);   // SettlementClass
const retry = isTransientFailure(settleResponse); // e.g. RPC timeout — safe to retry
const txHash = pendingReceiptTxHash(settleResponse); // tx broadcast but receipt unknown -> confirm, don't re-settle
```

## Configuration

```ts
type FacilitatorConfig = {
  privateKey: `0x${string}`;    // Pays gas for settlement transactions
  rpcUrl: string;                // RPC endpoint (validated — private hosts rejected unless dev ports)
  network: Network;              // CAIP-2 identifier (e.g., "eip155:8453")
  chain: Chain;                  // viem Chain object
  ownAddress?: `0x${string}`;   // Optional: skip fees for own transactions
  feeBasisPoints?: number;       // Optional: fee for third-party settlements
  ethUsdFeedAddress?: `0x${string}`; // Optional: Chainlink ETH/USD feed for the computed fee floor (workspace#45)
};
```

Incoming payloads whose `requirements.network` does not match the configured network are rejected (`network_mismatch`).

## Exports

**Functions:** `createFacilitator`, `createFacilitatorRoutes`, `classifySettlement`, `isTransientFailure`, `pendingReceiptTxHash`, `computeSettlementFee`, `settleGasUnits`, `cachedFeeEstimator`, `viemFeeDataReader`, `viemL1DataFeeReader`, `chainlinkEthUsdReader`

**Types:** `FacilitatorConfig`, `Facilitator`, `SchemeHandler`, `SettlementClass`, `CreateFacilitatorRoutesOptions`, `FeeEstimate`, `FeeReaders`, `ComputeSettlementFeeInputs`

## License

MIT — part of [x402cloud](https://github.com/x402cloud/x402cloud)
