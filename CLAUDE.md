# x402cloud

Open source x402 payment infrastructure for the agent economy.

## Monorepo Structure

```
packages/           ← npm packages (published to @x402cloud/*)
  protocol/         ← x402 protocol types, headers, encoding (zero deps)
  evm/              ← EVM scheme implementations (exact + upto)
  client/           ← client SDK (auto-pay 402 responses)
  middleware/       ← server middleware (Hono, generic)
  facilitator/      ← facilitator core logic (verify, settle)

apps/               ← deployed services
  facilitator-api/  ← hosted facilitator at x402cloud.ai
  infer/            ← AI inference API (infer.x402cloud.ai)
  acp-seller/       ← Virtuals ACP marketplace seller runtime

tests/              ← integration & e2e tests (compose real pieces)
  e2e/              ← on-chain e2e on Base Sepolia

examples/           ← usage examples
```

## Dependency Rules

- `packages/` have ZERO dependencies on `apps/`
- `apps/` import from `packages/` only
- `@x402cloud/protocol` is the base — no deps except TypeScript
- All EVM interactions use `viem` — no ethers, no @x402/*, no thirdweb
- Every package has its own unit tests
- e2e tests live in `tests/` — compose real pieces, never pollute production code

## Dependency Graph

```
@x402cloud/protocol     ← zero deps, just types + encode/decode
       ↑
@x402cloud/evm          ← protocol + viem
       ↑
@x402cloud/client       ← protocol + evm
@x402cloud/middleware    ← protocol + evm + hono
@x402cloud/facilitator  ← protocol + evm + viem
       ↑
apps/*                  ← packages only
tests/*                 ← packages only (composes them)
```

## Commands

```bash
pnpm install              # install all
pnpm build                # build all packages (topological order)
pnpm test                 # test all (unit tests)
pnpm -F @x402cloud/evm test   # test one package
pnpm -F e2e-tests test        # e2e payment flow (requires .env)
pnpm -F apps/infer dev        # dev one app
```

## Design Philosophy: Simple Made Easy

We follow Rich Hickey's design principles from "Simple Made Easy", "Hammock Driven Development", and "The Value of Values". These are not aspirational — they are enforced.

### Separate Concerns, Don't Braid Them

Each thing should do one thing. If you find yourself adding `if (isTest)` or `if (mode === "remote")` branches, you're complecting. Extract the shared scaffold, inject the varying parts as functions or data.

**Example:** The middleware has one payment flow (`core.ts`). Local signer vs remote facilitator are injected as `VerifyFn`/`SettleFn`. Adding a third strategy requires zero changes to the flow.

### Data Over Mechanisms

- Types are structural records, not classes
- Dispatch via data maps (`MODELS`, `HANDLERS`, `USDC_ADDRESSES`), not inheritance
- Functions take data and return data
- No hidden state, no singletons (lazy init for Workers is the one exception, documented)

### Immutability

- `UptoPayload` is the client's signed authorization — it is immutable
- Settlement amount is a separate parameter to `settleUpto()`, never mutated onto the payload
- Route configs are built once and frozen

### Require Less, Provide More

- `verifyUpto` takes `VerifySigner` (readContract + verifyTypedData) — not the full `FacilitatorSigner`
- `settleUpto` takes `FacilitatorSigner` (needs write access) — only what it needs
- `Facilitator` interface accepts typed data, not JSON strings — serialization lives at HTTP boundaries

### Accretion Over Breakage

- Add new schemes by adding files, not modifying existing ones
- Add new models by adding entries to `MODELS` — routes auto-generate
- Add new middleware strategies by composing `buildUptoMiddleware` with new verify/settle functions

### Fail Loudly at Boundaries

- `parseUsdcAmount` throws on invalid input (empty, NaN, negative)
- Payment headers are validated on decode, not deep inside verification
- Contract calls return typed error results, never throw silently

## Testing Philosophy

Tests follow the same Hickey principle: **compose simple parts, don't modify the system to be testable.**

### Unit Tests (packages/*/test/)
- Test pure functions with mock data
- Mock the `VerifySigner`/`FacilitatorSigner` interface — never mock viem internals
- Fast, no network, no state

### E2E Tests (tests/e2e/)
- Compose real pieces (real middleware + real facilitator + trivial handler)
- Run against Base Sepolia (real on-chain transactions)
- **No test models in production code** — the handler is trivial (`c.json({message: "hello"})`)
- **No mocks** — the payment flow is real, the handler is just data
- Requires `.env` with `TEST_PRIVATE_KEY`, `FACILITATOR_PRIVATE_KEY`, `RPC_URL`
- Get testnet USDC from https://faucet.circle.com (Base Sepolia)

### What NOT to do
- Never add test-only routes/models/config to production apps
- Never mock the thing you're testing — mock its dependencies
- Never test AI inference and payments together — they are separate concerns
- Never use `if (process.env.NODE_ENV === "test")` in production code

## x402 Protocol Summary

```
1. Client → Server:  POST /endpoint (no payment)
2. Server → Client:  402 + PaymentRequired (scheme, maxAmount, payTo, asset, network)
3. Client:           Signs Permit2 authorization for up to maxAmount
4. Client → Server:  POST /endpoint + PAYMENT-SIGNATURE header
5. Server:           Verify signature (no on-chain tx)
6. Server:           Execute request (run inference, etc.)
7. Server:           Meter actual usage → settlementAmount
8. Server:           Settle on-chain for actual cost (≤ maxAmount)
9. Server → Client:  200 + X-Payment-Settled header
```

## Adding a New EVM Network

1. Call `registerUsdcAddress("eip155:<chainId>", "0x...")` or pass `asset` in route config
2. Pass the viem `Chain` object when creating a facilitator
3. No code changes needed — the protocol, middleware, and EVM packages are chain-agnostic

## Future: Adding Non-EVM Networks (Solana, etc.)

1. Create `@x402cloud/solana` implementing verify/settle for Solana
2. The middleware's `buildUptoMiddleware(routes, verifyFn, settleFn)` accepts any verify/settle
3. The protocol layer (`@x402cloud/protocol`) is already network-agnostic

## Contract Addresses

- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3` (all EVM chains)
- x402 Upto Proxy: `0x4020633461b2895a48930Ff97eE8fCdE8E520002` (Base Sepolia only — not yet on mainnet)
- x402 Exact Proxy: `0x4020615294c913F045dc10f0a5cdEbd86c280001`
- USDC (Base): `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- USDC (Base Sepolia): `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Security Rules

- NEVER store private keys in code or git
- `.env` files are gitignored — always
- Facilitator wallet key is in environment only
- All Permit2 signatures verified before any settlement
- Settlement amount MUST be ≤ authorized amount (on-chain enforced)
- Nonces are single-use (Permit2 enforced)
- Deadlines enforced with 6-second buffer for block time
- Signature-only tamper check before settlement (no redundant on-chain reads — the contract enforces balance/allowance)
