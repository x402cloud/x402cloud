# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry below applies to all `@x402cloud/*` packages unless otherwise noted —
they are versioned together until a package needs to diverge.

## [Unreleased]

### Changed — BREAKING (pre-publish, no released versions affected)
- **Canonical Coinbase proxy migration (mainnet unblock).** All schemes now
  target the canonical CREATE2-deployed proxies — Upto
  `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`, Exact
  `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` — which exist at the same
  address on Base mainnet AND Base Sepolia (source vendored under
  `contracts/`). The witness encoding follows the canonical contracts:
  upto signs `Witness(address to,address facilitator,uint256 validAfter)`
  (the contract enforces `msg.sender == witness.facilitator`), exact signs
  `Witness(address to,uint256 validAfter)`; the legacy `extra` witness
  field is gone. Servers advertise their settlement address in
  `PaymentRequirements.extra.facilitator` (the middleware does this in its
  402 response); `createUptoPayload` throws if it is missing. Payloads
  signed against the legacy Sepolia proxies are not compatible.
  `PROXY_ADDRESSES` now maps both Base networks to the canonical
  addresses, and `scripts/verify-mainnet-proxies.ts` passes fail-closed on
  mainnet. E2E proves a real on-chain upto settlement through the
  canonical proxy on an Anvil fork (payee USDC balance asserted).

### Security
- **facilitator-api / facilitator-docker:** auth middleware is now bound to
  payment routes via `createFacilitatorRoutes({ auth })` so it cannot be
  accidentally omitted at the mount site. The Workers app fails closed (500)
  if `FACILITATOR_API_TOKEN` is unset; the Docker app refuses to start unless
  `FACILITATOR_ALLOW_NO_AUTH=true` is explicitly opted in.
- **@x402cloud/facilitator:** every verify/settle call now rejects with
  `network_mismatch` if `requirements.network` does not match the
  facilitator's configured network (defense in depth against cross-chain
  signature replay).
- **@x402cloud/evm:** deadline and `validAfter` parsing now uses
  `parseUnixSeconds` (BigInt + bounded), closing a `parseInt("999...")
  → Infinity` overflow that allowed signature reuse forever.
- **@x402cloud/evm:** settle paths re-check the deadline immediately before
  on-chain submission, so a long-metered request can't burn gas on an
  expired authorization.
- **@x402cloud/evm:** settlement errors are run through `sanitizeErrorMessage`
  before being returned (redacts long hex blobs and URLs that may carry
  RPC API keys).
- **@x402cloud/middleware:** `X-Payment-Settled` / `X-Payment-Payer` response
  headers are validated against strict patterns before being set, blocking
  CR/LF injection from a misconfigured facilitator.
- **@x402cloud/middleware:** route prices are validated at construction —
  empty or zero prices throw immediately instead of silently serving free
  traffic.
- **@x402cloud/facilitator:** RPC URL validation rejects non-`http(s)://`
  schemes, plain HTTP for non-localhost hosts, and embedded credentials.
- **apps/infer:** added CORS allow-list (env-configurable), HSTS / no-sniff
  / frame-deny secure headers, and an optional Cloudflare rate-limit
  binding for the free discovery routes.
- **apps/facilitator-api:** added secure-headers middleware (HSTS, no-sniff,
  frame-deny, no-referrer).

### Added
- `@x402cloud/probes`: `usdcBalance` probe (operator/revenue address USDC
  balance) and `summarizeSettlements(kv)` (24h settled/failed/pending
  rollup of a `SETTLEMENTS` KV namespace, degrading to `{ available:
  false }` when no KV is bound). `resolveFacilitatorAddress` extracted as
  the one shared facilitator-address lookup (`gasEstimate` and
  `usdcBalance` both use it).
- `apps/status`: mobile-first ops dashboard — wallet tiles for facilitator
  ETH gas and operator USDC, a settlement-health tile, and a 15-minute
  cron that POSTs a plain-text alert to `ALERT_WEBHOOK_URL` on low gas,
  any failing probe, or a settlement-failure spike. `/status` and `/` keep
  their existing JSON/route shape (`settlements` is an additive field).
- `@x402cloud/middleware`: `redactSignature(intent)` helper for safely
  forwarding `SettlementIntent` to logs / queues.
- `@x402cloud/middleware`: optional `onSettlementError(err, intent)` callback
  on `MiddlewareOptions` for surfacing fire-and-forget settlement failures.
- `@x402cloud/middleware`: `requestTimeoutMs` on `ResilientFetchConfig`
  (default 10s) — remote facilitator calls now abort instead of hanging.
- `@x402cloud/evm`: `NETWORK_NAME_TO_CAIP2` map and `resolveNetwork(name)`
  helper, replacing per-app `NETWORK_MAP` definitions.
- `@x402cloud/evm`: `parseUnixSeconds`, `MAX_UNIX_SECONDS`,
  `sanitizeErrorMessage` exports.

### Changed
- `apps/infer` now imports `NETWORK_NAME_TO_CAIP2` from `@x402cloud/evm`
  instead of defining its own table.
- `createFacilitatorRoutes(getFacilitator, options?)` — new optional second
  argument carrying `{ auth?: MiddlewareHandler }`. Backward compatible.

### Open-source readiness
- Added `"license": "MIT"` to `apps/facilitator-docker`, `apps/status`, and
  the three `examples/*` package manifests.
- Added `packages/probes/README.md` and `homepage` / `bugs` fields.
- Added `.nvmrc`, `.prettierrc.json`, `MAINTAINERS.md`, `.github/CODEOWNERS`,
  `.github/FUNDING.yml`, GitHub issue templates, and a PR template.
- Added CI status badge to README.

## [0.1.0] - 2026-04-26

Initial public release of the x402cloud monorepo. Implements the
[x402 protocol](https://www.x402.org/) end to end: HTTP-native micropayments
in USDC over EVM via Permit2.

### Added

#### Packages
- `@x402cloud/protocol` — protocol types, header encoding, and USDC amount
  parsing. Zero runtime dependencies.
- `@x402cloud/evm` — EVM scheme implementations (`exact` and `upto`) backed by
  Permit2. Pure functions over a `VerifySigner` / `FacilitatorSigner` interface
  so callers provide only what they need.
- `@x402cloud/client` — `wrapFetchWithPayment` auto-pays 402 responses.
- `@x402cloud/middleware` — Hono and generic middleware for accepting
  payments. Strategy pattern injects `verifyFn` / `settleFn`; the same flow
  powers the local-signer and remote-facilitator modes.
- `@x402cloud/facilitator` — facilitator core (verify + settle) plus a
  ready-to-mount Hono routes builder.
- `@x402cloud/probes` — health probes shared by the status dashboard.

#### Apps
- `apps/facilitator-api` — hosted facilitator on Cloudflare Workers (used at
  facilitator.x402cloud.ai).
- `apps/facilitator-docker` — Node-based facilitator for self-hosting.
- `apps/infer` — pay-per-call AI inference API (OpenAI-compatible, on
  Cloudflare Workers AI).
- `apps/acp-seller` — Virtuals ACP marketplace seller runtime with five
  offerings (text-gen, code-gen, deep-reasoning, embeddings, image-gen).
- `apps/indexer` — settlement indexer for Base / Base Sepolia.
- `apps/status` — public status dashboard backed by `@x402cloud/probes`.
- `apps/x402-indexer` — Goldsky pipeline definition for cross-chain
  settlement indexing.

#### Tests
- 170+ unit tests across all packages.
- `tests/e2e/` runs the full payment flow against Base Sepolia.

#### Examples
- `examples/accept-payments` — server using `remoteUptoPaymentMiddleware`.
- `examples/pay-for-inference` — client using `wrapFetchWithPayment`.
- `examples/run-facilitator` — self-hosted facilitator.

### Notes
- Settlement amount is always passed separately to `settleUpto` — the signed
  `UptoPayload` is never mutated.
- The middleware has one payment flow; verify/settle strategy is data, not
  branching.
- No `if (NODE_ENV === "test")` branches exist in production code; tests
  compose real pieces or mock at the signer interface.

[Unreleased]: https://github.com/x402cloud/x402cloud/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/x402cloud/x402cloud/releases/tag/v0.1.0
