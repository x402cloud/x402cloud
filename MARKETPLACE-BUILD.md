# Marketplace Build Plan & Log

> Operational build-out of x402cloud as an **agent-native service marketplace**.
> Merchant-of-record model: we resell curated services in USDC, 20% take rate.

## Goal

Ship a Sepolia-validated marketplace with three live service categories:

1. **LLM inference** — already exists, retrofit 20% margin
2. **Code sandbox** — Python + Node via Cloudflare Sandbox SDK
3. **Web scraping** — page-to-markdown + screenshot via Cloudflare Browser Rendering

Discovery via `marketplace.x402cloud.ai`. Agents use `@x402cloud/agent` SDK to
list, pay, and call any service in one line.

## Decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| Sandbox runtime | CF Sandbox SDK | Edge-native, no upstream bill |
| Scraping runtime | CF Browser Rendering | $5/mo per 1M loads, fat margin |
| Operator wallet | Single (`0x207C…8E88`) for all services | Keep accounting trivial until volume justifies splitting |
| Take rate | 20% (2000 bps) | Default in `applyMargin` |
| Catalog storage | In-code data | Move to KV when >10 services |
| Network | Base Sepolia first; mainnet after runbook | Already deployed, no spend |

## Design principles (Hickey)

- **Data over mechanism**: services are catalog entries, not classes.
- **Compose, don't braid**: margin layer is one function; every service uses it.
- **Require less, provide more**: catalog Worker has zero state, zero auth.
- **Accretion**: adding a service = adding one catalog entry + one route handler.
- **Fail loud at boundaries**: bad service id → 404, bad network → throw at startup.

## Plan: ordered, small steps

| # | Step | Where | Status |
|---|---|---|---|
| 1 | Add `MarketplaceService` type + `Catalog` to `@x402cloud/protocol` | main | ✅ done |
| 2 | Add `applyMargin` / `clampToAuthorized` / `retailPrice` to middleware | main | ✅ done |
| 3 | Scaffold `apps/marketplace` discovery Worker | main | ✅ done |
| 4 | Refit `apps/infer` to use 20% MARKUP, drop BASE_FEE | main | ✅ done |
| 5 | Build `apps/sandbox` (CF Sandbox SDK, Python + Node) | subagent | ✅ done |
| 6 | Build `apps/scrape` (CF Browser Rendering, markdown + PNG) | subagent | ✅ done |
| 7 | Build `packages/agent` SDK (discover + pay + call) | subagent | ✅ done |
| 8 | `scripts/sepolia-smoke.ts` — runnable verification against any network | subagent | ✅ done |
| 9 | `docs/MAINNET-RUNBOOK.md` (contracts, secrets, gas, alerting, rollback) | subagent | ✅ done |
| 10 | Final workspace test pass | main | ✅ done |

## Build log

### 2026-05-13 — Session start

**Step 1 done.** `packages/protocol/src/catalog.ts` created. `MarketplaceService`
+ `Catalog` types exported. Each service is pure data: id, category, endpoint,
payment config, schema, tags, examples.

**Step 2 done.** `packages/middleware/src/margin.ts`. Pure functions:
- `applyMargin(wholesale, bps)` — markup
- `clampToAuthorized(cost, max)` — never overcharge
- `retailPrice(wholesale, authorized, bps)` — full pipeline
- `DEFAULT_MARGIN_BPS = 2000` (20%)
- 12 unit tests pass.

**Step 3 done.** `apps/marketplace/` scaffolded. Hono Worker. Routes:
- `GET /` — HTML index
- `GET /services` — JSON catalog (filterable)
- `GET /services/:id` — service detail
- `GET /categories` — counts
- `GET /llms.txt` — agent docs
- `GET /.well-known/agent-card.json` — A2A discovery
- 7 catalog tests pass. Typechecks clean.

Workspace state: **23/23 turbo tasks green**, including on-chain e2e.

**Step 4 done.** `apps/infer/src/pricing.ts`:
- `MARKUP` bumped from 1.10 → 1.20 (matches `DEFAULT_MARGIN_BPS = 2000`).
- `BASE_FEE` removed — was complecting per-request fixed cost with usage. Micro stays micro.
- Tests updated. **38/38 pass.**

**Step 5 done** (subagent). `apps/sandbox/` created. Routes: `POST /python`,
`POST /node`. Pricing: $0.0005/sec wholesale × 1.20 retail × 30s cap = $0.018
maxPrice. Used `retailPrice` from middleware in `meter.ts`. **14/14** sandbox
tests pass. **25/25** turbo tasks green workspace-wide.

Catalog updated: `sandbox-python` and `sandbox-node` maxPrice now `"$0.018"`.

⚠️ **Operational note**: `@cloudflare/sandbox@0.7.0` has a transitive dep
(`@cloudflare/containers@0.1.1`) that fails Node ESM resolution outside a
Worker bundler. Worked around with a lazy import in `handler.ts`. This is fine
for production (Worker bundler) but means unit tests skip the actual SDK call.
Will need a real CF-side smoke test post-deploy.

**Step 6 done** (subagent). `apps/scrape/` created. Routes: `POST /page`,
`POST /screenshot`. Pricing: $0.001/req + $0.0001/sec wholesale × 1.20 retail.
Worst case retail = $0.0048, fits existing $0.005 catalog cap. **15/15** scrape
tests pass. **27/27** turbo tasks green workspace-wide.

⚠️ **Operational notes**:
- Browser Rendering binding `BROWSER`, uses `@cloudflare/puppeteer`.
- `wrangler dev --remote` required for local testing (binding has no local mode).
- Free tier: 10 min/day, 3 concurrent, 6 req/min — paid tier needed for prod.
- `nodejs_compat` flag required.

**Step 7 done** (subagent). `packages/agent/` created.

Public API:
```ts
createAgentClient(opts) -> {
  discover(filter?) -> Promise<MarketplaceService[]>
  getService(id)     -> Promise<MarketplaceService>
  call<T>(id, body)  -> Promise<T>    // discover + pay + call in one line
  fetchFor(id)       -> Promise<typeof fetch>
}
```

Composition: catalog fetch + existing `wrapFetchWithPayment` + optional
in-memory budget tracker. No new payment logic. 22 SDK tests pass.

**Steps 8 + 9 done** (subagent).

- `scripts/sepolia-smoke.ts` — runnable smoke test. `pnpm smoke:sepolia`
  with `TEST_PRIVATE_KEY=0x...` exercises marketplace + infer + sandbox +
  scrape using the agent SDK. Captures settle tx hashes from `X-Payment-Tx`
  header. `--network=base-mainnet` flag for post-deploy verification.
- `docs/MAINNET-RUNBOOK.md` — 10 sections, ~280 lines:
  prereqs / contract deploy / secrets / deploy order / bindings / alerting
  / rollback / day-1 criteria / cost ledger.

**🚧 Blocker for mainnet (documented):** The Upto + Exact proxy contract
source is NOT checked in. Addresses in `packages/evm/src/constants.ts` are
Coinbase deployments on Sepolia only. Two options laid out in runbook §3a:
1. Verify the same CREATE2 addresses exist on Base mainnet (likely — Coinbase
   may have deployed them). If yes, no contract work needed.
2. Vendor source from `coinbase/x402` reference impl and `forge create` to
   redeploy.

**Step 10 done.** Final workspace check: `pnpm test` → **29/29 turbo tasks
green**, FULL TURBO cache hit.

## Final state

- **5 new packages/apps**: marketplace, sandbox, scrape, agent SDK, scripts
- **2 new types** in protocol: `MarketplaceService`, `Catalog`
- **3 new helpers** in middleware: `applyMargin`, `clampToAuthorized`, `retailPrice`
- **10 services in catalog** across inference / sandbox / scraping
- **All on Base Sepolia** today; mainnet path documented but blocked on
  contract source resolution

## Post-build Hickey cleanup (round 2)

Followed up the review with 8 prioritised fixes (the two deferred items —
settlement queue, unified tagged errors — left for later).

| # | Fix | Outcome |
|---|---|---|
| 1 | `marginBps?: number` added to `MarketplaceService.payment`; meters now accept `marginBps` arg defaulting to `DEFAULT_MARGIN_BPS` | Take rate is data; per-category override is one entry change |
| 2 | Agent SDK records `X-Payment-Settled` (not `maxPrice`) | Per-day caps now reflect actual spend on upto routes |
| 3 | `BudgetTracker` is an injectable interface; `createInMemoryBudgetTracker` is the default impl | Multi-instance deploys can bring their own (KV/Redis) tracker |
| 4 | `apps/marketplace` imports `DEFAULT_USDC_ADDRESSES` from `@x402cloud/evm` | One source of truth for USDC contracts |
| 5 | `apps/infer` pricing now pure BigInt micro-USDC; `MARKUP` constant deleted | One pricing arithmetic, one truth |
| 6 | Catalog cached per env-key, served with `Cache-Control: public, max-age=60` | Free edge cacheability; `generatedAt` is build moment, not read moment |
| 7 | New `@x402cloud/discovery` package — `mountDiscovery(app, meta, routes)` | ~340 lines of duplicated discovery handlers removed across 3 apps; marketplace gained the surfaces it was missing |
| 8 | `createApp(env)` factory per service; `buildDeps(env)` closes over immutable record; mutable singletons gone | No `let middlewareInstance`, no `let cachedGetSandbox`, no `let cachedLaunch` anywhere in app code |

**Workspace after cleanup**: 31/31 turbo tasks green, ~290 tests across the
monorepo.

**What's gone (verified by grep)**:
- `let middlewareInstance` — 0 occurrences
- `let cachedGetSandbox` / `let cachedLaunch` — 0 occurrences
- `MARKUP = 1.x` constant — 0 occurrences

## Post-cleanup polish: kill the last catalog drift

After the round-2 cleanup landed I noticed the catalog still hardcoded
display prices (`$0.001` for `infer-fast`) while the actual route, after
the BigInt refit, charged `$0.002202`. That meant agents reading the
catalog under-budgeted by ~2× on inference. Real bug, flagged in the
review as "catalog `maxPrice` complected with provider pricing".

Created `@x402cloud/manifests` — one shared package owning the catalog
data for every service. Both the marketplace catalog AND each service
Worker import from it. Adding a service is now: new file in `packages/manifests/src/`,
register it in the marketplace assembler. No price values are duplicated
anywhere.

Catalog `maxPrice` corrections (old hardcoded → now-computed):

| id | old | new |
|---|---|---|
| infer-fast | $0.001 | $0.002202 |
| infer-smart | $0.001 | $0.000946 |
| infer-think | $0.01 | $0.012013 |
| infer-code | $0.01 | $0.002794 |
| infer-embed | $0.001 | $0.000115 |
| infer-image | $0.005 | $0.002280 |
| scrape-page | $0.005 | $0.004800 |
| scrape-screenshot | $0.005 | $0.004800 |
| sandbox-python / sandbox-node | $0.018 | $0.018000 (already aligned) |

Also added `infer-nano` and `infer-big` (live routes that the hand-written
catalog had silently omitted).

**Workspace after final polish**: 33/33 turbo tasks green, ~300 tests.

## Operator's next actions (outside this codebase)

1. Resolve §3a blocker — check if Upto proxy lives at same CREATE2 address
   on Base mainnet, or vendor source from x402 reference.
2. Bridge $300-500 to a fresh Base mainnet wallet.
3. Deploy sandbox + scrape to Sepolia first (they exist as code but were
   never deployed). Wrangler commands in their respective `wrangler.toml`.
4. Run `pnpm smoke:sepolia` against the new deployments to confirm.
5. Follow runbook deploy order for mainnet.




