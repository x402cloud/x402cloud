# Design

The shape of x402cloud, in one page. For *why* this exists, read [`VISION.md`](VISION.md).
For *how to work in this repo* (build/test commands, dependency rules, Hickey principles,
security rules), read [`CLAUDE.md`](CLAUDE.md) — this file does not repeat that, it only
summarizes the architecture and the data contracts that hold it together.

## The three-layer stack

`VISION.md` has the full strategic reasoning; the shape it produces is:

1. **Open-source library** (`packages/`) — the x402 protocol implementation, chain-agnostic,
   published as `@x402cloud/*`.
2. **Facilitator** (`apps/facilitator-api`, `apps/facilitator-docker`) — verifies and settles
   payments on-chain. The hosted one at `facilitator.x402cloud.ai` is the default; anyone can
   self-host the Docker image.
3. **Services** (`apps/infer`, `apps/sandbox`, `apps/scrape`, `apps/marketplace`,
   `apps/acp-seller`) — x402-paid APIs built on top of layers 1 and 2, plus the marketplace
   that catalogs them.

## Monorepo layout

```
packages/                ← published to @x402cloud/*
  protocol/               x402 types, headers, encoding — zero deps, the base of everything
  evm/                     EVM payment schemes (exact + upto) — protocol + viem
  client/                  auto-pay 402 responses — protocol + evm
  middleware/              server middleware (Hono) — protocol + evm + hono
  facilitator/             facilitator verify/settle core — protocol + evm + viem
  agent/                   agent SDK: discover marketplace services + auto-pay in one import
  discovery/               builders for discovery surfaces (openapi.json, llms.txt, agent-card,
                            agents.json, sitemap.xml, robots.txt, api-catalog)
  manifests/               single source of truth for service catalog + pricing, shared by
                            the marketplace and each priced service so they can't drift apart
  probes/                  health/readiness checks for x402cloud infra, used by apps/status

apps/                     ← deployed services
  facilitator-api/         hosted facilitator — facilitator.x402cloud.ai
  facilitator-docker/       same facilitator core, packaged for self-hosting
  infer/                   pay-per-call AI inference — infer.x402cloud.ai
  sandbox/                 pay-per-call code execution
  scrape/                  pay-per-call web scraping
  marketplace/             x402 service catalog + discovery surfaces
  status/                  public status dashboard — status.x402cloud.ai
  indexer/                 cron-driven on-chain settlement indexer (KV + R2)
  x402-indexer/            Goldsky pipeline definition (on-chain event indexing)
  acp-seller/              Virtuals ACP marketplace seller runtime (self-hosted container)

site/                     ← x402cloud.ai static site
tests/e2e/                ← on-chain e2e, composes real packages against Base Sepolia
examples/                 ← runnable usage examples
```

Current deploy status and the exact recipe for each surface live in [`DEPLOY.md`](DEPLOY.md) —
that file, not this one, is the source of truth for what's live where.

## Dependency graph

```
@x402cloud/protocol      ← zero deps, just types + encode/decode
       ↑
@x402cloud/evm           ← protocol + viem
       ↑
  +----+---------+------------+
  |               |            |
client        middleware   facilitator     agent (client + catalog lookup)
                    ↑
                manifests  ← protocol + middleware (applyMargin, DEFAULT_MARGIN_BPS)
       ↑
   discovery, probes  ← standalone, no dependency on protocol/evm
       ↑
     apps/*  ← packages only, never depend on each other directly
```

`packages/` never depend on `apps/`. Apps compose packages; they don't share code with each
other except through a package. Full rules in `CLAUDE.md` § Dependency Rules.

## The protocol flow

```
1. Client → Server:  POST /endpoint (no payment)
2. Server → Client:  402 + PaymentRequired (scheme, amount, payTo, asset, network)
3. Client:           Signs Permit2 authorization covering the quoted amount
4. Client → Server:  POST /endpoint + PAYMENT-SIGNATURE header
5. Server:           Verify signature (no on-chain tx)
6. Server:           Execute request (run inference, scrape, etc.)
7. Server:           Meter actual usage → settlementAmount
8. Server:           Settle on-chain for actual cost (≤ the quoted amount)
9. Server → Client:  200 + X-Payment-Settled header
```

Settlement goes through the canonical Coinbase CREATE2 proxies (`contracts/`, vendored for
reference) — same addresses on Base mainnet and Base Sepolia, so the same signed payload shape
is valid on both networks; only the `network` field and RPC endpoint change. See
`CLAUDE.md` § Contract Addresses for the exact addresses.

## The data contracts

These are the shapes every layer agrees on — the seam between server, client, and facilitator.
Source of truth is always the code (`packages/protocol/src/types.ts`,
`packages/evm/src/types.ts`); this is a map, not a copy to keep in sync by hand.

**`PaymentRequirements`** (`@x402cloud/protocol`) — what a 402 response advertises:

```ts
type PaymentRequirements = {
  scheme: Scheme;             // "exact" | "upto"
  network: Network;           // CAIP-2, e.g. "eip155:8453"
  asset: string;              // token contract address
  amount: string;             // price in smallest units — the x402 v2 spec field
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;  // upto scheme carries `extra.facilitator` here —
                                      // the address allowed to settle (witness-bound)
};

// What arrived from outside and has not been parsed yet. Distinct type, so the
// compiler can tell "an offer someone sent us" from "an offer we have checked".
type PaymentRequirementsInput = Omit<PaymentRequirements, "amount"> & {
  amount?: string;
  maxAmount?: string;   // legacy spelling, accepted on input
};

parseRequirements(input): { ok: true; value: PaymentRequirements } | { ok: false; error: string }
```

### The price field

There is **one** price field in memory: `amount`, spelled the way the x402 v2 specification
spells it. The wire carries a second copy under this implementation's original name,
`maxAmount`, so clients pinned to the old spelling keep working.

That mirror is produced in exactly one place — `toWireRequirements` /
`toWirePaymentRequired` in `packages/protocol/src/headers.ts`, applied when a 402 body or a
`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` header is serialized — and removed in exactly one
place, `parseRequirements`. No other module reads or writes `maxAmount`.

`parseRequirements` prefers `amount` and **rejects** a payload whose two spellings disagree.
A remote server showing a budget guard one price while asking to be paid another is refused,
not reconciled.

**Retirement plan.** The mirror is a compatibility shim with an end date, not a second
canonical name:

| Date | Step |
|---|---|
| 2026-08-16 | Collapsed to `amount` internally; `maxAmount` becomes wire-only (this change). |
| Mainnet launch | Stop emitting `maxAmount` on **new** schemes; keep it on `upto`/`exact`. |
| 2027-02-16 (≥6 months after the last published package emitting it) | Delete `toWireRequirements`, its two call sites, and the `maxAmount` branch of `parseRequirements`. Inputs carrying only `maxAmount` then fail to parse with "requirements has no price". |

Bring the date forward if telemetry shows no client sending `maxAmount`-only offers. Do not
push it back without adding a row here saying why.

**`UptoPayload`** (`@x402cloud/evm`) — the client's signed authorization, immutable once
signed:

```ts
type UptoPayload = {
  signature: `0x${string}`;
  permit2Authorization: Permit2Authorization<UptoWitness>;
};

type Permit2Authorization<W> = {
  from: `0x${string}`;
  permitted: { token: `0x${string}`; amount: string };
  spender: `0x${string}`;
  nonce: string;
  deadline: string;
  witness: W;
};

// Canonical upto witness — binds the settling facilitator, enforced on-chain
// (`msg.sender == witness.facilitator`).
type UptoWitness = { to: `0x${string}`; facilitator: `0x${string}`; validAfter: string };
```

The settlement amount is a separate argument to `settleUpto()` — never mutated onto the
payload — which is what lets the server settle for less than the quoted `amount` (the
"upto" in the scheme name) without re-signing anything. Less, never more: the quote is a
ceiling, enforced independently in `packages/middleware/src/core.ts` (clamps the metered
amount) and in `settleUpto` (rejects `settlement_exceeds_quote`). The payer's signed budget
`permitted.amount` is a separate, weaker bound — agent wallets authorize far more than one
call's price, so it is not a price ceiling.

**`ServiceMeta` / catalog entries** (`@x402cloud/discovery`, `@x402cloud/manifests`) — the
data that drives the marketplace catalog, `llms.txt`, `openapi.json`, and each priced service's
own route table, generated from one source so the catalog and the actual routes can't disagree
on price.

## Where the design philosophy lives

The Hickey-style rules that shape this codebase (data over mechanisms, immutability, accretion
over breakage, fail loudly at boundaries) are enforced rules, not aspirations — they're kept in
full in `CLAUDE.md` § Design Philosophy so there's one copy. This file only points there.
