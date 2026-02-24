# Pay for Inference

Client-side example showing how to pay for AI inference using `@x402cloud/client`.

## What it does

- Wraps `fetch` with `wrapFetchWithPayment` so x402 payments are handled automatically
- Calls `infer.x402cloud.ai` for chat completions — identical to the OpenAI API format
- If the server returns 402, the client signs a USDC payment authorization and retries transparently

## How it works

1. `payFetch` sends the request normally
2. Server responds with `402 Payment Required` including pricing details
3. Client automatically signs a Permit2 authorization (no tokens leave the wallet until settlement)
4. Client retries with the signed `PAYMENT-SIGNATURE` header
5. Server verifies, runs inference, and settles for actual usage

## Key concepts

- **`wrapFetchWithPayment`** — drop-in fetch replacement that handles 402 responses
- **`ClientSigner`** — interface with `address` and `signTypedData` (works with any viem account)
- **Upto scheme** — client authorizes up to `maxPrice`, server charges actual cost (always less or equal)
