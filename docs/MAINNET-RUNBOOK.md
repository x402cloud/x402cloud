# Mainnet Runbook — x402cloud on Base

Operational guide for promoting x402cloud from Base Sepolia testnet to Base
mainnet (`eip155:8453`). Audience: the operator running the deploy.

## 1. Goal & scope

Going to mainnet means running the facilitator and all paid services
(`infer`, `sandbox`, `scrape`, plus the `marketplace` catalog) against Base
mainnet (`eip155:8453`) with real USDC settlement. The facilitator wallet
holds real ETH for gas; settlement happens on-chain for every paid call.

The existing Sepolia deployment (`eip155:84532`) **stays online** during
the dogfood window and acts as the rollback target. Mainnet services
launch on dedicated `*-mainnet.x402cloud.ai` subdomains; main DNS only
flips after a one-week clean run.

Out of scope for this runbook: Solana, any other EVM chain (Arbitrum,
Optimism, Polygon — config exists in `DEFAULT_USDC_ADDRESSES` but no
deploy targets), and the `acp-seller` ACP marketplace runtime.

## 2. Prerequisites (capital + accounts)

| Item | Detail |
| --- | --- |
| `DEPLOYER_KEY` | Base mainnet EOA for one-shot contract deploy. Fund ~0.02 ETH (~$60–80 at $3k/ETH). Burner key — discard after deploy. |
| `FACILITATOR_KEY` | Long-lived operator wallet that signs `settle()` txs. Separate key, separate seed phrase. Fund 0.05–0.1 ETH (~$150–300) to start; monitor and top up. |
| Base mainnet RPC | Alchemy Growth ($49/mo) or QuickNode equivalent. Public `https://mainnet.base.org` is rate-limited and will drop settlement under load. |
| ETH → Base bridge | Coinbase direct withdraw to Base, or [bridge.base.org](https://bridge.base.org). Allow 10–20 min for L1→L2. |
| Key storage | 1Password (or equivalent) vault. **Never** in `.env` checked anywhere. |
| Test USDC on mainnet | Bridge ~$5 USDC from L1 (or buy on Base) for smoke-test wallet. |

The two keys are not interchangeable. `DEPLOYER_KEY` only needs to exist
long enough to deploy and verify contracts. `FACILITATOR_KEY` is the
production hot wallet — alert on it.

## 3. Contracts on Base mainnet — RESOLVED 2026-06-10

### 3a. Resolution: canonical Coinbase CREATE2 proxies

The original blocker (legacy proxies `0x402063…0002`/`0x402061…0001`
existed only on Sepolia, with no source in this repo) was resolved by
migrating the whole stack to the **canonical Coinbase proxies**, which are
CREATE2-deployed at the same address on Base mainnet AND Base Sepolia:

- `X402_UPTO_PROXY = 0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`
- `X402_EXACT_PROXY = 0x402085c248EeA27D92E8b30b2C58ed07f9E20001`

Source: `coinbase/x402` `contracts/evm/src`, vendored for reference under
`contracts/`. The canonical witness encoding differs from the legacy one —
upto binds the settling facilitator
(`Witness(address to,address facilitator,uint256 validAfter)`, enforced as
`msg.sender == witness.facilitator`), exact is
`Witness(address to,uint256 validAfter)`. Servers advertise the settlement
address via `PaymentRequirements.extra.facilitator` in the 402 response.

**No contract deploy is needed for mainnet launch.** `DEPLOYER_KEY` in §2
is no longer required (Coinbase's CREATE2 deployment also means anyone can
deploy the same contracts to the same addresses on any new EVM chain —
see the upstream repo's `contracts/evm/README.md`).

Before flipping any service to mainnet, run the fail-closed gate:

```bash
pnpm -F x402cloud-scripts verify:mainnet
```

It must print `OVERALL: PASS` (it checks bytecode presence AND a settle
selector match for both proxies on mainnet, plus Permit2/USDC anchors).
Verified PASS on 2026-06-10. Also verified by e2e: real on-chain upto
settlement through the canonical proxy on an Anvil fork of Base Sepolia
(`pnpm -F e2e-tests test` asserts the payee's USDC balance delta).

## 4. Worker secrets to set per environment

All apps already declare the public config (`NETWORK`, `FACILITATOR_URL`,
`OPERATOR_ADDRESS`, `RPC_URL`) in `wrangler.toml`. Secrets must be set
out-of-band with `wrangler secret put`.

| App | Secret | Who has it | How to set |
| --- | --- | --- | --- |
| `facilitator-api` | `FACILITATOR_PRIVATE_KEY` | Operator (1Password) | `wrangler secret put FACILITATOR_PRIVATE_KEY --env mainnet` |
| `facilitator-api` | `FACILITATOR_API_TOKEN` | Operator (1Password) | `wrangler secret put FACILITATOR_API_TOKEN --env mainnet` |
| `indexer` | `BASE_RPC_URL` | Operator (Alchemy dashboard) | `wrangler secret put BASE_RPC_URL` |
| `indexer` | `BASE_SEPOLIA_RPC_URL` | Operator (Alchemy dashboard) | `wrangler secret put BASE_SEPOLIA_RPC_URL` |
| `infer`, `sandbox`, `scrape`, `marketplace` | none required | — | These workers hold no private keys. They only call the facilitator over HTTPS. |

`FACILITATOR_API_TOKEN` is a bearer token that paying middleware uses to
authenticate to the facilitator. Generate with `openssl rand -hex 32`,
store both sides (issuer + middleware env) in 1Password.

For each worker, run `wrangler secret list --env mainnet` after setting
to confirm presence (values are not echoed).

## 5. Deploy order

Numbered, do in sequence. Each step assumes the previous one verified
green.

1. **Deploy `facilitator-api` to mainnet.** Add a `[env.mainnet]` block
   to `apps/facilitator-api/wrangler.toml` with `NETWORK = "eip155:8453"`,
   `RPC_URL = "<alchemy-base-mainnet-url>"`, and the existing
   `OUR_ADDRESS`. Worker name `x402cloud-facilitator-mainnet`. Custom
   domain `facilitator-mainnet.x402cloud.ai`. Then:

   ```bash
   cd apps/facilitator-api
   wrangler secret put FACILITATOR_PRIVATE_KEY --env mainnet
   wrangler secret put FACILITATOR_API_TOKEN --env mainnet
   wrangler deploy --env mainnet
   ```

2. **Deploy service workers** (`infer`, `sandbox`, `scrape`) with
   mainnet env. For each, add a `[env.mainnet]` block:

   ```toml
   [env.mainnet]
   name = "x402cloud-<app>-mainnet"
   [env.mainnet.vars]
   NETWORK = "eip155:8453"
   FACILITATOR_URL = "https://facilitator-mainnet.x402cloud.ai"
   OPERATOR_ADDRESS = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88"
   [env.mainnet.route]
   pattern = "<app>-mainnet.x402cloud.ai"
   custom_domain = true
   ```

   **Named environments do not inherit bindings from the top level** — the
   `vars`/`route` block above is not the whole contract for `infer`,
   `sandbox` and `scrape`. Redeclare whatever other bindings the app's
   top-level config already has, under `[env.mainnet.<binding>]` /
   `[[env.mainnet.<binding>]]`, or the mainnet worker deploys with no way to
   reach them at runtime:

   - `infer` also needs `[env.mainnet.ai]` with `binding = "AI"` (mirrors
     the top-level `[ai]` block).
   - `sandbox` also needs `[[env.mainnet.containers]]` (same
     `class_name`/`image`/`instance_type`/`max_instances` as the top-level
     block), `[[env.mainnet.durable_objects.bindings]]` for the `Sandbox`
     class, and `[[env.mainnet.migrations]]` with `tag = "v1"` and
     `new_sqlite_classes = ["Sandbox"]`.
   - `scrape` also needs `[env.mainnet.browser]` with `binding = "BROWSER"`
     (mirrors the top-level `[browser]` block).
   - `facilitator-api` (step 1, above) needs its own
     `[[env.mainnet.durable_objects.bindings]]` for `SettlementDO`, its own
     `[[env.mainnet.migrations]]`, and its own settle-retry queue bindings
     under a mainnet-suffixed queue name (e.g. `settle-retry-mainnet` /
     `settle-retry-mainnet-dlq`) rather than sharing testnet's `settle-retry`.

   Then `wrangler deploy --env mainnet` per app.

3. **Deploy `marketplace`** last, with mainnet env pointing at the
   `*-mainnet` service URLs. The marketplace is pure metadata — no
   secrets. Update its in-code catalog (or KV-stored catalog if migrated)
   so each service entry's `payment.network` is `eip155:8453` and
   `endpoint.url` is the `*-mainnet.x402cloud.ai` URL.

4. **Update DNS.** All four `*-mainnet.x402cloud.ai` records are created
   automatically by `custom_domain = true`. Verify each resolves and
   serves a 200 within ~2 minutes.

5. **Smoke test.** Bridge ~$5 USDC to a fresh test wallet, fund it with
   a few cents of Base ETH (for the customer-side Permit2 approve
   transaction — one-off). Then:

   ```bash
   TEST_PRIVATE_KEY=0x... pnpm smoke:sepolia -- --network=base-mainnet
   ```

   See `scripts/sepolia-smoke.ts` for the contract.

## 6. Resource bindings to create

Per the existing `apps/indexer/wrangler.toml` pattern, create fresh
bindings for mainnet (do not reuse the Sepolia KV/R2 — different cursor,
different data):

```bash
# KV cursor for mainnet indexer
wrangler kv namespace create CURSOR --env mainnet
# → returns new id; paste into [env.mainnet] block in apps/indexer/wrangler.toml

# R2 analytics bucket (or reuse with prefixing)
wrangler r2 bucket create x402-analytics-mainnet

# Sandbox: the Durable Object + container binding are declared in
# wrangler.toml and provisioned on deploy. No CLI step needed beyond
# `wrangler deploy --env mainnet`. The migration tag must stay "v1".

# Scrape: Browser Rendering binding is account-level. Confirm the binding
# is enabled on the account dashboard before deploying the mainnet worker.
# Free tier (10 min/day, 3 concurrent) WILL throttle production traffic —
# upgrade to Browser Rendering paid tier ($5/mo per 1M loads).
```

The `BROWSER` binding does not need any CLI setup beyond the dashboard
toggle. It is referenced by name in `apps/scrape/wrangler.toml`.

## 7. Alerting & monitoring

Three alerts at minimum:

1. **Facilitator wallet low-balance.** Page when ETH balance on
   `FACILITATOR_KEY` address drops below 0.01 ETH on Base mainnet. Use a
   cron-triggered Worker that reads the balance via Alchemy and posts to
   PagerDuty / a webhook. Add as a probe (see below).

2. **Settlement failure spike.** The facilitator emits structured logs
   on every `settle()` call. Wire a Cloudflare Workers Logpush →
   destination of choice (Datadog, S3, Logflare). Alert on > 5
   settlement failures in a 5-minute window.

3. **Liveness.** `packages/probes` already polls facilitator + infer.
   Add a new target in `packages/probes/src/targets.ts`:

   ```ts
   "mainnet": {
     name: "mainnet",
     rpc: "https://mainnet.base.org",
     facilitator: "https://facilitator-mainnet.x402cloud.ai",
     infer: "https://infer-mainnet.x402cloud.ai",
     network: "eip155:8453",
   },
   ```

   The `production` entry currently points at the Sepolia facilitator
   (mismatched with its `eip155:8453` network) — that is a stale config
   and should be renamed to `mainnet` rather than left as-is.

## 8. Rollback plan

The fast lever is DNS. Each mainnet service runs on its own
`*-mainnet.x402cloud.ai` hostname during dogfood. To roll back:

1. Stop directing traffic at `*-mainnet` (revert client docs / SDK
   defaults).
2. The Sepolia workers remain bound to their original `*.x402cloud.ai`
   hostnames untouched, so anything pointing at them keeps working.
3. Optionally `wrangler delete --env mainnet` per app to take the
   mainnet workers offline entirely — but prefer leaving them up so logs
   remain inspectable for the post-mortem.

If the main `*.x402cloud.ai` DNS has already been flipped to the mainnet
workers (post dogfood), the rollback is a single `custom_domain` switch
back to the Sepolia workers via wrangler or the Cloudflare dashboard.
Plan an extra week of Sepolia-up-and-paid-for after the cutover for
exactly this reason.

## 9. Day-1 success criteria

- All four `*-mainnet.x402cloud.ai` hostnames return 200 on a health
  endpoint and 402 on a paid endpoint.
- `pnpm smoke:sepolia -- --network=base-mainnet` exits 0 with on-chain
  settlement tx hashes printed for `infer`, `sandbox`, and `scrape`.
- Facilitator wallet's first 10 mainnet settlements all succeed on
  Basescan (no reverts, gas cost under 60k per tx).
- Indexer cron produces at least one parquet file in
  `x402-analytics-mainnet` R2 within the first hour.
- Probes for the new `mainnet` target stay green for 24h.

## 10. Costs ledger

Capital + operating estimate to operationalise mainnet:

| Item | One-off | Monthly |
| --- | --- | --- |
| `DEPLOYER_KEY` gas (one-time, if redeploying proxies) | ~$80 | — |
| `FACILITATOR_KEY` ETH float | ~$200 | top-ups depending on volume |
| Alchemy / QuickNode Growth RPC | — | $0 (free tier) to $49 |
| Cloudflare Workers paid plan | — | $5 (already needed for Browser Rendering paid tier) |
| Browser Rendering paid tier | — | $5 per 1M loads |
| Total to start | **~$280** (one-off) | **~$10–60/mo** baseline |

The $250–400 envelope from the VISION discussion holds. The biggest
variable is `FACILITATOR_KEY` top-up cadence, which is a function of how
many settlements per day and how aggressive Base mainnet base fees get.
At 21k gas × ~50k cost per settlement × 1 gwei base fee = ~1e-6 ETH per
settle, i.e. ~0.001 ETH per 1000 paid calls. Profit at 20% take rate on
~$0.005 average call = $1 per 1000 calls revenue vs ~$3 gas — **the
service is unprofitable at micro-prices until gas drops or volume picks
up**. Document this honestly; plan to subsidise the first 100k calls.
