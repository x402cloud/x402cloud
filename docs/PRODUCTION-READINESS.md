# Production Readiness — verified snapshot (2026-06-10)

Point-in-time audit of what is live, what is proven, and what blocks
mainnet revenue. Every claim below was verified on-chain or against the
live services on the date above — not inferred from docs. The execution
plan for closing the gaps is [MAINNET-RUNBOOK.md](MAINNET-RUNBOOK.md);
this file is the scoreboard.

## What is live and green

| Check | Result |
| --- | --- |
| `pnpm build` | 18/18 tasks pass |
| `pnpm test` | 34/34 tasks pass (all unit suites) |
| facilitator.x402cloud.ai | `/health` 200, `/supported` → exact+upto on `eip155:84532` |
| infer.x402cloud.ai | `/health` 200 |
| status.x402cloud.ai | `/health` 200, 8 probes incl. facilitator gas-wallet balance |
| x402cloud.ai | landing page 200 (CTAs + pricing section) |
| Durable settlement | DO coordinator + queue retry shipped and unit-tested (I1/I2 invariants) |
| Chain-ID guard | facilitator rejects `requirements.network` ≠ configured network (`network_mismatch`) |
| Mainnet deploy gate | `scripts/verify-mainnet-proxies.ts` — fail-closed ABI/bytecode verifier |

## Verified blockers (in dependency order)

### 1. Proxy contracts on Base mainnet — RESOLVED 2026-06-10

The legacy proxies the repo originally targeted exist only on Sepolia
(`eth_getCode` on mainnet returns `0x`). Resolved the same day by
migrating the stack to the **canonical Coinbase CREATE2 proxies**, which
have verified bytecode on BOTH Base mainnet and Sepolia at the same
addresses (Upto `0x4020A4f3…0002`, Exact `0x402085…0001`), including the
new witness encoding (upto binds the facilitator via
`extra.facilitator`). Proof, all on 2026-06-10:

- `pnpm -F x402cloud-scripts verify:mainnet` → `OVERALL: PASS`
  (fail-closed bytecode + settle-selector check on mainnet)
- `pnpm -F e2e-tests test` → 4/4, including a real on-chain upto
  settlement through the canonical proxy on an Anvil fork of Base
  Sepolia, asserted by the payee's USDC balance delta
- Full unit suite 34/34 after migration

No contract deploy and no `DEPLOYER_KEY` are needed anymore. Remaining
mainnet steps are operational only: runbook §4–§9 (secrets, env blocks,
resources, deploy order, smoke tests).

### 2. npm packages unpublished — blocks library adoption

`npm view @x402cloud/<name>` → 404 for all nine packages (verified
2026-06-10). Metadata, dist builds, and READMEs are ready; only the
publish itself is missing.

Operator actions:
- [ ] `npm login` as the `x402cloud` org owner (or set `NPM_TOKEN` repo
      secret for `.github/workflows/release.yml`)
- [ ] Tag `v0.1.0` and push, or follow [PUBLISHING.md](../PUBLISHING.md)
      topological order manually

### 3. Wrong Cloudflare account logged in locally — blocks all deploys

`wrangler whoami` on this machine resolves to the Mozartguitars account
(`60981b…`), which has no x402cloud workers. The infer wrangler comment
references the NativeKloud account (`331224…`). Until the right account
is active, nothing here can be deployed or have namespaces created.

Operator actions:
- [ ] `wrangler login` (or `CLOUDFLARE_API_TOKEN`) against the account
      that owns the `x402cloud.ai` zone and the live workers

### 4. marketplace / scrape / sandbox not deployed

`marketplace.x402cloud.ai`, `scrape.x402cloud.ai`, and
`sandbox.x402cloud.ai` do not resolve (curl exit 000, no DNS). The code
builds and the wrangler configs declare the custom domains — deploying
each worker creates the DNS records.

Operator actions (after item 3):
- [ ] `pnpm -F marketplace exec wrangler deploy` (same for scrape, sandbox)
- [ ] scrape only: upgrade Browser Rendering off the free tier before
      advertising it (runbook §6)

### 5. infer settlement recording disabled

The `SETTLEMENTS` KV binding in `apps/infer/wrangler.toml` is commented
out because no namespace exists yet (a placeholder id breaks
`wrangler deploy`). Payments work without it; reconciliation records are
the only thing missing.

Operator actions (after item 3):
- [ ] `wrangler kv namespace create SETTLEMENTS`, paste the id, uncomment
      the block, redeploy infer

### 6. Alerting is dashboard-only

status.x402cloud.ai probes everything important (including facilitator
gas balance — warns below 0.01 ETH) but nothing pages a human. Runbook §7
specifies the three alerts (low balance, settlement-failure spike,
liveness).

Operator actions:
- [ ] Point an external uptime monitor (e.g. UptimeRobot / CF health
      checks) at `status.x402cloud.ai/status?target=testnet` and alert on
      any `"fail"` in the JSON
- [ ] After mainnet launch, same for `?target=mainnet`

## Explicitly deferred (known, not blocking)

- **Unit economics — RESOLVED 2026-08-14 (workspace#45), subsidy plan
  RESCINDED.** The take is now `max(wholesale × marginBps, computedFee)`
  (`@x402cloud/middleware`'s `computeTake`/`retailPrice`), where
  `computedFee` is `@x402cloud/facilitator`'s `computeSettlementFee` —
  measured settle gas units × live network fees × a live ETH/USD read, with
  a fail-closed upper-bound fallback (never under-charges) and the degraded
  state surfaced via `/fee`'s `X-Fee-Degraded` header. Big calls still price
  at the competitive 20% headline; only micro calls hit the floor. No call
  settles at a loss by design, so there is nothing to subsidise — runbook
  §10's "subsidise the first 100k calls" plan is struck (see its updated
  text). Still open: `SETTLE_GAS_UNITS` in `packages/facilitator/src/fee.ts`
  are engineering estimates pending real on-chain re-measurement (no
  Foundry/anvil in the authoring environment) — `tests/e2e/gas-measurement.test.ts`
  re-measures them on an Anvil fork and must be run (and the table corrected
  if it drifts) before this floor prices real mainnet settlements. The
  batch-settlement scheme that amortises gas across calls, driving the floor
  toward zero, is filed separately (workspace#46) and is post-launch, first-priority
  follow-up work.
- **Multi-chain** (Arbitrum/Optimism/Polygon): USDC addresses exist in
  config; no proxies, no deploy targets.
- **Staging environment / auto-deploy from CI**: deploys are manual by
  design for now; CI runs build+test+e2e.
- **Key custody**: facilitator key is a hot wallet in Worker secrets;
  multi-sig/hardware custody is a post-launch hardening item.

## Order of operations to revenue

1. Fix Cloudflare login (blocker 3) → redeploy facilitator + infer (they
   now advertise/require `extra.facilitator` and the canonical proxies),
   deploy marketplace + KV namespace (blockers 4, 5) — *testnet stack
   complete, same day*.
2. Publish npm packages (blocker 2) — *adoption channel open*.
3. Execute MAINNET-RUNBOOK §4–§9 (secrets, env blocks, resources, deploy,
   smoke test) — contracts already live, verifier already PASS — *real
   USDC settlement*.
4. Wire external alerting (blocker 6) before announcing.
