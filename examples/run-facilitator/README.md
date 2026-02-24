# Run Facilitator

Example showing how to run your own x402 payment facilitator using `@x402cloud/facilitator`.

## What it does

- Creates a facilitator instance with a private key for on-chain settlement
- Exposes `/verify` and `/settle` HTTP endpoints that servers can call
- Servers using `remoteUptoPaymentMiddleware` point to this facilitator

## How it works

1. `createFacilitator` sets up viem clients from the provided private key and RPC URL
2. `/verify` — validates a payment signature off-chain (no gas cost)
3. `/settle` — submits a Permit2 transfer on-chain for the actual usage amount (costs gas)

## Key concepts

- **Facilitator** — a trusted intermediary that verifies and settles x402 payments
- **Private key** — the facilitator pays gas for settlement transactions; fund this address with ETH
- **Verify** — checks the Permit2 signature is valid and the payer has sufficient USDC allowance
- **Settle** — calls the x402 proxy contract to transfer USDC from payer to payee
