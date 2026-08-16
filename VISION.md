# Vision: x402cloud.ai

## Position

**x402cloud.ai sells metered services that agents pay for per request. The plumbing is the standard's; the product is what runs behind the 402.**

Revised 2026-08-16. The earlier thesis put the facilitator first — own the library, own the
default facilitator, and let services follow. That thesis was written before Cloudflare closed both
ends of the rail. It no longer holds, and this document says why and what replaces it.

## What changed in 2026

| Date | What shipped | Effect on us |
|---|---|---|
| Apr 2026 | Linux Foundation takes the x402 standard | The spec is neutral. Nobody wins by owning the protocol |
| Jul 2026 | Linux Foundation x402 Foundation goes operational — 40 members, Cloudflare, Stripe, Visa, Mastercard, Google, AWS, Circle | Same conclusion, with a bigger table |
| 1 Jul 2026 | Cloudflare [Monetization Gateway](https://blog.cloudflare.com/monetization-gateway/) — payment rules at the edge, like WAF rules | The sell side is a config change for anyone already on Cloudflare |
| 4 Aug 2026 | Cloudflare [Wallets + cloudflare.pay](https://blog.cloudflare.com/wallets/) — agent wallets, spend caps, allow-lists | The buy side belongs to Cloudflare too |
| ongoing | Coinbase runs the default public facilitator, free | The middle has no price to charge |

A facilitator holds no funds. It verifies a signature and broadcasts a pre-signed transaction. A
merchant with its own RPC can skip it. Coinbase gives that away; Stripe charges 1.5%. There is no
defensible margin between a free incumbent and a bundled one, and the buyer never chose us anyway
— Cloudflare's wallet did.

So: **stop competing where the value does not accrue.**

## The new shape

```
┌─────────────────────────────────────────────────┐
│  SERVICES — the product, the revenue            │
│  Metered APIs agents pay for per request        │
│  Sovereign EU inference first                   │
├─────────────────────────────────────────────────┤
│  METERING — the thin layer we keep              │
│  `upto`: authorize a ceiling, settle the        │
│  real cost after the work is done               │
├─────────────────────────────────────────────────┤
│  PROTOCOL — the standard's, not ours            │
│  x402 v2, official schemes, any facilitator     │
└─────────────────────────────────────────────────┘
```

### Protocol: conform, don't compete

We track the Linux Foundation spec and stay wire-compatible with stock clients — `@x402/fetch`,
Cloudflare's Agents SDK, anything that speaks x402 v2. That is a maintenance obligation, not a
moat, and we treat it that way.

**Binding rule:** a 402 we emit must be payable by a client that has never heard of x402cloud, and
a 402 from any conformant server must be payable by our client. Where our names and the spec's
names differ, the wire carries both and the inbound path normalizes (`normalizeRequirements` in
`@x402cloud/protocol`). Accretion, not breakage.

The packages stay open source and stay published. They are how a developer meets us and how we
keep our own services honest — not a product line to defend.

### Metering: the one piece worth owning

Fixed-price payment (`exact`) is solved and commoditized. **Usage-priced payment is not.** An
inference call's cost is unknown until the tokens are generated. The `upto` scheme — authorize a
ceiling, settle the actual figure — is the only sane way to bill an agent for work whose price
emerges from the work.

We already have this working end to end: the client signs a ceiling, the server runs the request,
a `meter()` function computes the real cost, and settlement moves only that. Everything a
usage-priced API needs is in `@x402cloud/middleware`.

That is a small surface, deliberately. It is the difference between "a payment library" and "the
way you charge for compute".

### Services: where the money is

**Sovereign metered inference is the flagship.** Cloudflare, Coinbase and Stripe are US companies.
An EU buyer under GDPR, a healthcare provider, a public body — none of them can route prompts or
settlement through a US-owned stack, however good the DX. That constraint is not a preference and
it will not be competed away.

NativeKloud already owns the answer: `api.nativekloud.eu` (see the `platform/` project) runs
open-weight models on EU bare metal with zero content retention and no US vendor in the serving
path. x402cloud supplies the metered payment layer in front of it. Neither project has to become
the other.

| Service | Status | What it is |
|---|---|---|
| **Sovereign inference** (`api.nativekloud.eu`) | design | EU-hosted, usage-metered, agent-payable. The flagship. Constrained by `platform/`'s sovereignty rules — see the open question below |
| `infer.x402cloud.ai` | live (testnet) | Cloudflare Workers AI behind `upto` metering. Proves the rail, not the moat. Useful as the public reference implementation |
| Agent identity | idea | ERC-8004 is unowned. Genuinely valuable, genuinely hard. Not a 2026 commitment |
| Ecosystem analytics | dropped | Depended on transaction flow through our facilitator. No flow, no data |

### Open question, stated not hidden

`platform/` forbids any Cloudflare dependency and any US-owned service — including USDC (Circle,
US) and Base (Coinbase, US). Sovereign x402 inference therefore cannot simply reuse
`infer.x402cloud.ai`'s stack. It needs either an EU-issued stablecoin, an EU settlement path, or
an explicit, documented, customer-visible exception.

This is the first design question to settle, and it is a `hammock` session, not a coding task. The
answer determines whether the flagship is one product or two.

## What we stopped doing

- **Racing to be the default facilitator.** Ours keeps running for our own services and for anyone
  who wants a self-hostable one. It is infrastructure we operate, not a market we are entering.
- **Positioning the library as the product.** It stays open and maintained. It is not the pitch.
- **Building an analytics business on facilitator flow** that will not exist.

## Design principles

1. **Conform where it's a standard, differentiate where it's a product.** Protocol code is a cost centre.
2. **Meter honestly.** Charge the real cost, never the ceiling. It is the whole reason `upto` exists.
3. **Sovereignty is the moat, not the tech.** Anyone can copy the code. Nobody can relocate Cloudflare.
4. **Agent-first.** Zero onboarding, zero API keys, payment is authentication.
5. **Simple Made Easy.** Data over mechanisms, accretion over breakage.

## Related

- `nativekloud/platform` — sovereign inference API, the flagship's compute side
- `CLAUDE.md` — repository structure and engineering rules
- [x402 v2 specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md)
