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

### Mainnet config prep — RESOLVED 2026-08-14

Three of the four gaps this line item tracked are config-only and now done
(no deploy, no secrets, no real resource ids — verified by reading the repo,
not by running anything against a live account):

- **`[env.mainnet]` blocks** exist in all five `wrangler.toml`s that need
  them (`facilitator-api`, `infer`, `sandbox`, `scrape`, `marketplace`),
  matching the shape in [MAINNET-RUNBOOK.md](MAINNET-RUNBOOK.md) §5 — vars
  swapped to mainnet values, worker name suffixed `-mainnet`, custom domain
  `<app>-mainnet.x402cloud.ai`. `RPC_URL` in `facilitator-api` stays a
  placeholder (no real key ever committed). `infer`'s mainnet `NETWORK` is
  `"base"`, not `"eip155:8453"` — it resolves network through the friendly-name
  map (`NETWORK_NAME_TO_CAIP2`), unlike the other four apps.
- **`packages/probes/src/targets.ts`** already had a correct `mainnet` entry
  (`facilitator: null, infer: null`, `network: "eip155:8453"`) predating this
  change — the runbook §7 snippet showing real URLs filled in is the *future*
  state once those services actually launch, not a current gap.
- **DEPLOY.md** now documents the mainnet KV/R2 commands (infer SETTLEMENTS,
  indexer CURSOR, indexer analytics bucket) that previously existed only in
  the runbook — an operator following DEPLOY.md's own flow no longer has to
  cross-reference a second document to find them.

Still genuinely operator-only, none of it done here: logging into the right
Cloudflare account (blocker 3 below), filling in a real mainnet `RPC_URL`,
setting the mainnet secrets (`FACILITATOR_PRIVATE_KEY`,
`FACILITATOR_API_TOKEN`), running the actual `wrangler kv namespace create` /
`wrangler r2 bucket create` commands against the account (which mint real
ids that then need pasting back into the relevant `wrangler.toml`), any
`wrangler deploy --env mainnet`, and DNS. None of those can be done from a
repo checkout.

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

- **Unit economics**: at micro-prices, mainnet gas exceeds the take per
  call (runbook §10) — launch plan subsidises early volume.
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
3. Execute MAINNET-RUNBOOK §4–§9 (secrets, resources, deploy, smoke test) —
   contracts already live, verifier already PASS, `[env.mainnet]` config
   blocks already in every `wrangler.toml` (see "Mainnet config prep" above)
   — *real USDC settlement*.
4. Wire external alerting (blocker 6) before announcing.
