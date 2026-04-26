# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry below applies to all `@x402cloud/*` packages unless otherwise noted —
they are versioned together until a package needs to diverge.

## [Unreleased]

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
