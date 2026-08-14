# Design: `batch-settlement` scheme

Source: [radekdymacz/workspace#46](https://github.com/radekdymacz/workspace/issues/46), approved
by Radek 2026-08-14. This is the hammock-style design pass the issue asks for **before any code,
and explicitly before any Solidity** — nothing in this doc has landed in a package. Do not start
implementation until Radek has signed off on the open questions at the bottom.

Location note: this repo has no `docs/design/` convention yet — this file establishes one,
following the naming style used elsewhere in the workspace (`DESIGN-<TOPIC>-<date>.md`).

---

## 1. Problem statement

[workspace#45](https://github.com/radekdymacz/workspace/issues/45) (open as PR #10, not touched by
this doc) fixed the immediate bug: a percentage-only take on a micro-amount call couldn't cover the
fixed gas cost of the `settle()` that collects it. The fix is a computed floor —
`take = max(wholesale * marginBps/10000, settlementFee)`, `settlementFee` measured live from chain
data (`packages/facilitator/src/fee.ts`'s `computeSettlementFee`, gas units × live base+priority fee
× Base's L1 data fee × a live ETH/USD read × a safety multiplier, failing closed to a conservative
upper bound on any degraded input).

That guarantees **no call settles at a loss**. It does not fix the *shape* of the problem: `settle()`
runs once per call, so its gas cost is a fixed dollar amount per call regardless of the call's price.
At the micro end (sub-$0.01 calls) that fixed cost is the floor — it dominates the price, and the
floor sits above Coinbase's own facilitator, which settles for a flat $0.001 with gas sponsored
(a subsidy Coinbase can afford because it owns Base's sequencer). We can't out-price a sequencer
subsidy with a per-call on-chain settle. Cited from the issue: *"Batch-settlement is the structural
answer: amortise one on-chain settle across many calls so the per-call gas floor falls toward
zero — cheaper than the subsidised competition, not chasing it (the Lightning Network model: pure
proportional fees, no floor)."*

In this repo's own terms (`CLAUDE.md` § Design Philosophy — data over mechanisms): the gas floor is
not a policy bug, it's a **mechanism mismatch**. `settlementFee` is priced per on-chain transaction;
`exact`/`upto` couple "one call" to "one transaction" 1:1. Batch-settlement decouples them — many
calls, one transaction — so the floor's *input* changes (`batch gas ÷ calls in batch` instead of
`batch gas ÷ 1`) without the pricing *model* from workspace#45 changing at all. That's the accretion
this design aims for: a new scheme sitting beside `exact`/`upto`, not a rewrite of either.

## 2. Spec review

### `upto` (existing, for contrast)

Per-call: client signs a Permit2 `UptoWitness`-bound authorization for up to `maxAmount`; server
verifies the signature (no chain read — `packages/evm/src/upto/verify.ts`); server settles on-chain
for the metered amount (`settleUpto`, `packages/evm/src/upto/settle.ts`). One signature, one
transaction, one call. `UptoPayload` is immutable once signed (`CLAUDE.md` § Immutability); the
settlement amount is a separate argument to `settleUpto`, which is exactly what lets the server
charge less than authorized without a re-sign. This immutability discipline is the thing
batch-settlement has to preserve at a different granularity (a *voucher* replaces the *payload* as
the immutable signed unit; see below).

### `batch-settlement` (upstream spec, fetched 2026-08-14)

The x402 spec repo (`x402-foundation/x402`) already has a `specs/schemes/batch-settlement/`
directory — this is not something we'd be naming or shaping ourselves. Three documents:
`scheme_batch_settlement.md` (network-agnostic), `scheme_batch_settlement_evm.md` (the EVM binding
we need), `scheme_batch_settlement_cloudflare.md` (a **credit-backed** binding where Cloudflare acts
as Merchant of Record for its own AI-crawl-control product — not applicable to us; out of scope, see
§6).

The general scheme (network-agnostic doc) frames it as three phases, which map cleanly onto our
existing `verify`/`settle` split plus one new stage:

```
Commit     — client attaches a cryptographic payment commitment; validated and stored
             BEFORE the resource is served (this is verify(), same as today)
Accumulate — commitments held in a voucher store (new — nothing in `exact`/`upto` accumulates)
Redeem     — value transfer happens out of band: one on-chain call redeems many commitments
             (this is settle(), but now N:1 instead of 1:1)
```

It distinguishes two trust models: **capital-backed** (on-chain escrow, payment channel, or
delegated authorization against a wallet balance — no counterparty risk beyond the contract) and
**credit-backed** (a billing relationship with a trusted intermediary, no on-chain capital). The
issue asks for the escrow case specifically — capital-backed — which is also the only one that
doesn't require us to extend credit to a payer we've never billed before. This design covers
capital-backed only (§6, non-goals).

### The EVM binding, and the escrow use case named in the issue

The EVM doc describes exactly the flow in workspace#46: *"An AI agent pre-funds an on-chain escrow
at session start. Each sub-cent API call produces a signed voucher drawn against that balance. The
provider accumulates vouchers and redeems them in a single on-chain transaction at session end."*
Mechanically, per the fetched spec:

- A **channel** is the escrow unit — an immutable `ChannelConfig` (payer, receiver, token,
  authorizer addresses, a withdraw delay, a salt), hashed (EIP-712) into a `channelId` that is the
  channel's identity on-chain.
- The payer deposits once (ERC-3009 `receiveWithAuthorization` for USDC, or Permit2 as the universal
  fallback — same signature primitive `packages/evm` already uses for `exact`/`upto`).
- Per call, the payer signs a **voucher**: a cumulative ceiling (`maxClaimableAmount`) against the
  channel, not a fresh authorization. Vouchers are monotonically increasing, so a later voucher
  supersedes an earlier one — the server only needs to hold the highest one it's seen.
- The provider claims accumulated vouchers in one batched `claim()` call, then a permissionless
  `settle()` transfers everything claimed-but-unsettled for a `(receiver, token)` pair. Claim and
  transfer are separate steps, which matters for us (see facilitator section, §4).
- Refunds are two-track: cooperative (immediate, needs the receiver side's signature) or a unilateral
  timed withdrawal (15 minutes to 30 days, contract-enforced) if the provider goes dark. This is the
  mechanism that answers "every voucher either settled or refundable" (§5).

**Caveat on how this was researched:** the upstream docs were retrieved through a fetch-and-summarize
tool, not read as raw text — several passes were needed to pull out the struct fields and function
list, and the tool could not confirm it saw the complete file (in particular, the full 30+-entry
error list and the exact byte-for-byte `Voucher` EIP-712 type were summarized, not quoted verbatim).
**Before writing any integration code, whoever picks this up should pull the raw markdown directly**
(`git clone` or `curl` the spec repo, not a summarized fetch) and diff it against §4 below.

## 3. Escrow contract due diligence

The issue is explicit: *"do NOT design a novel escrow contract without a hammock session first."*
Good news — we may not need one at all.

**A reference implementation already exists upstream**, published in the same spec directory as the
EVM binding doc, not something Coinbase or x402cloud would need to write:

| Contract | Cited canonical address (CREATE2, "all supported EVM chains") |
|---|---|
| `x402BatchSettlement` | `0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003` |
| `ERC3009DepositCollector` | `0x4020806089470a89826cB9fB1f4059150b550004` |
| `Permit2DepositCollector` | `0x4020425FAf3B746C082C2f942b4E5159887B0005` |

This is the same shape as our existing `x402ExactPermit2Proxy` / `x402UptoPermit2Proxy` — a canonical
Coinbase-lineage CREATE2 deployment, vendored for reference under `contracts/` (see
`contracts/README.md`), never a build target in this repo. If it holds up under verification, the
same pattern applies here: **we call it, we don't write it.**

**What is NOT yet confirmed, and is a blocking due-diligence gap, not a design question:**

1. `contracts/README.md` states the `exact`/`upto` proxies are deployed "on Base mainnet AND Base
   Sepolia" — a specific, checkable claim, verified today by
   `scripts/verify-mainnet-proxies.ts` (a fail-closed ABI/bytecode verifier gating mainnet deploys,
   per `docs/PRODUCTION-READINESS.md`). The fetched batch-settlement docs say "deterministic address
   across all supported EVM chains via CREATE2" but the specific chain list wasn't recoverable from
   this pass — CREATE2 determinism only produces a live contract on a chain where *someone has
   actually sent the deploy transaction*. **Nobody should assume `x402BatchSettlement` is live on
   Base Sepolia until an `eth_getCode` check confirms it**, the same way `verify-mainnet-proxies.ts`
   does for the other two proxies today.
2. No Solidity source path was found for these three contracts in this pass (unlike `exact`/`upto`,
   which point to `coinbase/x402` `contracts/evm/src`). Before vendoring anything under `contracts/`
   for audit-ability (the stated purpose of that directory), find the actual source repo — likely
   still `coinbase/x402` or a sibling, but not confirmed here.
3. No audit status was stated in what was fetched.

**Recommendation:** treat items 1–3 as a short, separate verification spike (bytecode check + find
the source repo + confirm audit status), run *before* committing to this contract in code, not
something this doc can close on its own. If Base Sepolia deployment doesn't exist, the honest options
are: wait for Coinbase/the x402 foundation to deploy it, deploy it ourselves at the same address via
the same CREATE2 deployer (permissionless, per `contracts/README.md`'s existing note for the other
two proxies — "anyone can, only gas required"), or escalate to Radek that this scheme's timeline
depends on someone else's rollout. **None of that is a decision this doc makes** — it is exactly the
kind of contract-facing judgment call the issue's hard requirement is protecting against. Do not
write a line of Solidity, and do not deploy anything, without Radek in the loop first.

## 4. Data contracts (sketch — not final, no code changes made)

Following the existing package boundaries and the dependency graph in `DESIGN.md` — structural
records, dispatch via data, nothing shared through class hierarchies (`CLAUDE.md` § Data Over
Mechanisms).

### `@x402cloud/protocol`

```ts
export type Scheme = "exact" | "upto" | "batch-settlement";

// PaymentRequirements.extra for batch-settlement carries the channel binding —
// same pattern as upto's extra.facilitator (witness-bound settlement address).
type BatchSettlementExtra = {
  channelId?: `0x${string}`;       // absent on first 402 — client hasn't opened a channel yet
  receiverAuthorizer: `0x${string}`;
  withdrawDelaySeconds: number;    // 900–2_592_000 per the EVM binding
};
```

No other protocol-level change: `PaymentRequired`, `PaymentPayload`, `VerifyResponse` all stay
scheme-agnostic today (`payload: Record<string, unknown>` already accommodates a voucher shape
without a protocol change) — accretion, not modification (`CLAUDE.md` § Accretion Over Breakage).

### `@x402cloud/evm`

New sibling directory `packages/evm/src/batch/`, mirroring `upto/` and `exact/`'s
`client.ts` / `verify.ts` / `settle.ts` / `facilitator.ts` split:

```ts
// types.ts additions
export type ChannelConfig = {
  payer: `0x${string}`;
  payerAuthorizer: `0x${string}`;      // address(0) reserved for EIP-1271 — see §6, non-goal
  receiver: `0x${string}`;
  receiverAuthorizer: `0x${string}`;
  token: `0x${string}`;
  withdrawDelay: number;               // seconds
  salt: `0x${string}`;
};

export type Voucher = {
  channelId: `0x${string}`;            // EIP712Hash(ChannelConfig) — the channel's on-chain identity
  maxClaimableAmount: string;          // cumulative ceiling, monotonically non-decreasing
  signature: `0x${string}`;            // payerAuthorizer's EIP-712 signature over this voucher
};

export type ChannelSnapshot = {
  channelId: `0x${string}`;
  balance: string;                     // deposited − withdrawn − refunded
  totalClaimed: string;
  withdrawRequestedAt: number | null;
  refundNonce: string;
};
```

`verifyVoucher` mirrors `verifyUpto`'s shape: `VerifySigner` in, signature-only check (EIP-712 over
the fetched `Voucher` type) — **plus one thing `upto` doesn't need**, a monotonicity check against
the last voucher this channel has already accepted, since a voucher's whole safety property is "each
one supersedes the last," and that state lives off-chain until claimed. `settleBatch` mirrors
`settleUpto`'s two-step sign/send port (`FacilitatorSigner`) but calls `claim()` for a set of
vouchers across possibly-many channels, then `settle(receiver, token)` — two contract calls per
batch, not one, which the facilitator layer needs to account for (§I5/I6 below).

### `@x402cloud/client`

Extends the existing `wrapFetchWithPayment` surface (`packages/client/src/fetch.ts`) rather than
adding a parallel one — same principle as `upto` sitting beside `exact` today:

```ts
// A session is opened once per (payer, receiver, token) — not per call.
export type BatchSession = {
  channelId: `0x${string}`;
  config: ChannelConfig;
  lastVoucher: Voucher | null;   // highest-ceiling voucher signed so far; null before first call
};

// New: deposit is a one-time on-chain action, not part of the per-request hot path.
export type DepositResult =
  | { success: true; channelId: `0x${string}`; transaction: `0x${string}` }
  | { success: false; errorReason: string };
```

`wrapFetchWithPayment` needs one new decision point: when a 402's `accepts` includes
`batch-settlement` and the caller already holds an open `BatchSession` for that `(payTo, asset,
network)`, sign a new voucher (pure off-chain crypto, no gas) instead of building a fresh Permit2
authorization. Opening a session (the deposit) stays a distinct, explicit call — never triggered
implicitly by a 402, both because it's an on-chain transaction with real gas cost and because "should
I fund a channel with this counterparty" is a decision the caller should make, not the SDK.

### `@x402cloud/middleware` + `@x402cloud/facilitator`

This is where "reuse the durable-settlement machinery" (the issue's own wording) does real work,
because the shape is closer than it first looks. Today's `apps/facilitator-api/src/settlement-store.ts`
keys a Durable Object per `(scheme, nonce)` — one-shot, short-lived. Batch-settlement's natural key is
`channelId` — long-lived, many accumulation events over its life, one (or a few) claim/settle events.
Same coordinator *pattern*, different lifetime:

```ts
// facilitator: the off-chain ledger a channel accumulates before a batch flush.
export type BatchAccumulatorRecord = {
  channelId: `0x${string}`;
  latestVoucher: Voucher;              // superseding discipline means we only need the newest
  chargedCumulativeAmount: string;     // what we've actually billed against it so far
  openedAt: number;
  lastActivityAt: number;
};

export type VoucherAcceptResult =
  | { accepted: true; chargedCumulativeAmount: string }
  | { accepted: false; reason: string };   // e.g. "cumulative_exceeds_balance" — mirrors the
                                            // on-chain revert name so a rejection here and a
                                            // revert there are traceably the same failure

export type BatchFlushTrigger =
  | { kind: "size"; maxVouchers: number }
  | { kind: "value"; maxCumulativeAmount: string }
  | { kind: "time"; maxOpenMs: number }
  | { kind: "manual" };
```

`buildUptoMiddleware`'s injection shape (`VerifyFn`/`SettleFn` as data, per `CLAUDE.md`'s own
worked example) is the template: a `buildBatchMiddleware` takes an `AcceptVoucherFn` and a
`FlushFn`, and the actual flush trigger (§7, open question) is policy data passed in, not a branch
inside the flow.

### Pricing integration (workspace#45, read-only reference — not touched here)

No change to `packages/facilitator/src/fee.ts`'s formula. The floor input changes from
`computeSettlementFee()` (one settle, one call) to `computeSettlementFee() ÷ estimatedBatchSize` —
and *how* `estimatedBatchSize` is produced before a batch has closed is an open question (§7), not
answered by this doc.

## 5. Invariants

Named to sit beside the existing durable-settlement invariants (`apps/facilitator-api/src/
settlement-store.ts`'s I1/I2 — "once a txHash exists, never re-broadcast; a success may never be
recorded as failed"), at the same rigour, because this scheme holds client deposits and the issue
says so explicitly.

- **I3 — Escrow conservation.** At every point in a channel's life,
  `totalClaimed(channelId) + refunded(channelId) ≤ deposited(channelId)`. The contract enforces this
  at `claim()` time (the fetched spec names `cumulative_exceeds_balance` / `insufficient_balance`
  reverts), but the off-chain accumulator must enforce it **before** serving another call on credit —
  the contract only catches an over-claim at the eventual on-chain call, which may be hours after the
  calls that caused it were already served for free.
- **I4 — Voucher reconciliation (the issue's own phrasing: "every voucher either settled or
  refundable").** A signed voucher's `maxClaimableAmount` is monotonically non-decreasing across the
  channel; the accumulator must never claim a voucher with a *lower* ceiling after a higher one was
  already seen (superseded-voucher discipline). Symmetrically, any voucher the server never claims
  must remain refundable to the payer via the contract's cooperative-or-timed-withdrawal path — no
  voucher may exist in a state where neither claim nor refund can recover the funds behind it.
- **I5 (I1 for batch) — No re-broadcast of a claim/settle.** Once a claim-batch transaction exists
  on-chain for a given `(channelId, claim-batch-hash)`, never resubmit it — only confirm the known
  hash. Same rationale as I1: a re-broadcast against an already-consumed authorization wastes gas and
  risks recording a real success as a failure.
- **I6 (I2 for batch) — Sticky success, per channel.** A claim or settle that succeeded on-chain must
  never be recorded or returned as failed. Because `claim()` and `settle()` are two separate calls
  here (unlike `upto`'s single `settle()`), this invariant has two checkpoints, not one — a partial
  success (claim landed, settle hasn't yet) is a distinct, nameable state, not a failure.
- **I7 — Fail closed under uncertain escrow state.** If the facilitator cannot confirm (via a recent
  on-chain read or its own accumulator) that a channel's remaining balance covers the next call's
  worst-case cost, it must refuse to serve that call on credit rather than accumulate a voucher it
  isn't sure is collectible — the same fail-closed discipline `computeSettlementFee` already applies
  to degraded fee inputs (workspace#45), extended to escrow state.

All of I3–I7 need unit tests with fixture channel states (mirroring `packages/facilitator/test/
settlement.test.ts`'s style) plus an Anvil-fork e2e proving the full N-calls-to-one-settle path with
a deliberate refund case, per the issue's "Done when."

## 6. Non-goals for v1

- **Multi-chain batching.** One channel is bound to one chain (`channelId` is chain-bound per the
  EVM binding's domain separator); a client operating across chains opens one channel per chain.
- **Cross-scheme batching.** A route is `exact`, `upto`, or `batch-settlement` — never a mix. The
  issue is explicit that `exact`/`upto` stay the default and batch is opt-in per route/client.
- **The credit-backed trust model** (the Cloudflare-as-Merchant-of-Record binding fetched in §2). We
  have no billing-identity infrastructure and the issue asks for the escrow case specifically.
- **EIP-1271 smart-contract-wallet payers** (`payerAuthorizer = address(0)`). The reference spec
  supports it; v1 targets EOA payers only, same as `exact`/`upto` today.
- **Channel renewal/rotation UX** (what a client does when a channel is drained or its withdraw
  delay is about to matter). Worth a follow-up once the base flow is proven.
- **Deploying `x402BatchSettlement` ourselves.** Only in scope if upstream due diligence (§3) turns
  up no live deployment on Base/Base Sepolia and Radek decides it's worth doing — not assumed here.
- **Writing or auditing the escrow contract's Solidity.** Explicitly out of scope per the issue's
  hard requirement; §3 is due diligence on an existing artifact, not a design for a new one.

## 7. Open questions for Radek

1. **Contract due diligence gate.** Before any integration code: confirm (bytecode check, like
   `verify-mainnet-proxies.ts` does today) whether `x402BatchSettlement` and the two deposit
   collectors are actually deployed on Base Sepolia, find the Solidity source repo, and check audit
   status. If not deployed on Base Sepolia, do we wait, deploy it ourselves at the same CREATE2
   address, or de-prioritise this scheme until upstream catches up?
2. **Channel granularity.** Is a channel 1:1 per `(payer, our facilitator, USDC)` — so one channel
   serves every x402cloud service a client calls — or per-service (`infer`, `sandbox`, `scrape` each
   get their own channel with the same payer)? This decides whether `receiver` in `ChannelConfig` is
   the shared facilitator address or each app's own payout address, which is a real multi-tenant
   accounting question for the marketplace, not just a naming choice.
3. **Batch flush policy.** Trigger by voucher count, accumulated value, elapsed time, or some
   combination — and what are the actual thresholds? This is a direct risk/economics tradeoff: larger
   batches amortise gas further but leave more unsettled client money resting in accumulator state
   between flushes (I3's exposure window).
4. **Gas-floor estimation before a batch closes** (workspace#45 integration). Charge every call in an
   open batch the conservative floor as if it were the only call (batch size = 1) until the batch
   closes and the real size is known, or use a rolling average from the channel's/route's history?
   The conservative choice is simpler and never underprices; it also means the floor doesn't visibly
   improve until a batch actually flushes, which may look confusing on a pricing page.
5. **Opt-in mechanism.** Does a route advertise `batch-settlement` in its 402 `accepts` array
   alongside `exact`/`upto` and let the client SDK choose (closest to how `accepts` already works),
   or is it a route-config flag the service operator sets explicitly? The issue says "opt-in per
   route/client" but not which side makes the choice.
6. **Durable Object lifetime.** I1/I2's DO-per-`(scheme, nonce)` is naturally short-lived (one
   settlement, then done). A DO-per-`channelId` could stay open for the life of a long-running agent
   session — is that an acceptable storage/cost shape for the hosted facilitator, or does it need an
   explicit close/archive path once a channel is fully settled and refunded to zero?

---

**Status: awaiting Radek's sign-off on §7 before any implementation begins.** Per the issue, that
includes the escrow contract itself — §3's due-diligence spike should happen first and may change
what's assumed here.
