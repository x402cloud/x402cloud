# Deploy

This guide collects every deployable surface in the monorepo and the minimal
steps to run it. Each app's `wrangler.toml`, `Dockerfile`, or `.env.example`
remains the source of truth — this file is the index.

| App | Runtime | Status | URL (production) |
|---|---|---|---|
| `apps/facilitator-api` | Cloudflare Workers | Live | `facilitator.x402cloud.ai` |
| `apps/facilitator-docker` | Docker / any Node 22+ host | Self-host | — |
| `apps/infer` | Cloudflare Workers AI | Live | `infer.x402cloud.ai` |
| `apps/status` | Cloudflare Workers | Live | `status.x402cloud.ai` |
| `apps/indexer` | Cloudflare Workers (cron) | Live | internal |
| `apps/acp-seller` | Long-running Node container | Self-host | — |
| `apps/x402-indexer` | Goldsky pipeline | Live | internal |
| `site/` | Cloudflare Pages | Live | `x402cloud.ai` |

Prerequisites: `pnpm install && pnpm build` from the repo root before any deploy.

---

## 1. Cloudflare Workers apps

All four CF Worker apps share the same flow:

```bash
pnpm build
pnpm -F <app> exec wrangler deploy
```

You need `wrangler login` once per machine, plus account access to the
`x402cloud` Cloudflare account.

### `facilitator-api`

Pays gas to settle on-chain — needs a hot wallet key.

```bash
pnpm -F facilitator-api exec wrangler secret put FACILITATOR_PRIVATE_KEY
pnpm -F facilitator-api exec wrangler secret put FACILITATOR_API_TOKEN
pnpm -F facilitator-api exec wrangler deploy
```

Vars (`NETWORK`, `OUR_ADDRESS`, `RPC_URL`) are baked into `wrangler.toml`.
Switch to mainnet by editing `NETWORK = "eip155:8453"` and an appropriate
`RPC_URL` before deploy.

### `infer`

OpenAI-compatible inference, paid via the public facilitator. No secrets —
just a CF Workers AI binding configured in `wrangler.toml`.

```bash
pnpm -F infer exec wrangler deploy
```

### `status`

Public dashboard; can take optional private RPC URLs to avoid public-RPC
rate limits. Also runs a 15-minute cron (`[triggers]` in `wrangler.toml`)
that re-checks everything and POSTs a plain-text alert to a webhook (an
ntfy.sh-style topic URL) when the facilitator's ETH balance is low, any
probe fails, or settlements show a failure spike — a no-op with no webhook
secret set.

```bash
pnpm -F status exec wrangler secret put TESTNET_RPC_URL      # optional
pnpm -F status exec wrangler secret put MAINNET_RPC_URL      # optional
pnpm -F status exec wrangler secret put OPERATOR_ADDRESS      # optional override for the USDC-balance probe
pnpm -F status exec wrangler secret put ALERT_WEBHOOK_URL     # optional — enables the cron alert POST
pnpm -F status exec wrangler deploy
```

Settlement health (last-24h settled/failed/pending) reads the same
`SETTLEMENTS` KV namespace `apps/infer` writes to — read-only (`list`/`get`
only, no `put`). It shows "not available" until the binding exists. One-time
setup, after `apps/infer`'s own `SETTLEMENTS` namespace exists (see its
`wrangler.toml`):

```bash
CLOUDFLARE_ACCOUNT_ID=331224f43e4f448483cad2f1185ea965 \
  npx wrangler kv namespace create SETTLEMENTS   # skip if apps/infer already created one — reuse its id
# paste the id into the commented [[kv_namespaces]] block in apps/status/wrangler.toml, uncomment, redeploy
```

### `indexer`

Cron-driven; needs a KV namespace and an R2 bucket. **First-time only:**

```bash
pnpm -F indexer exec wrangler kv namespace create CURSOR
# copy the returned id into apps/indexer/wrangler.toml under [[kv_namespaces]]
pnpm -F indexer exec wrangler r2 bucket create x402-analytics
pnpm -F indexer exec wrangler secret put BASE_RPC_URL          # optional
pnpm -F indexer exec wrangler secret put BASE_SEPOLIA_RPC_URL  # optional
pnpm -F indexer exec wrangler deploy
```

Backfill historical settlements:

```bash
pnpm -F indexer backfill -- --from-block <N> --to-block <M>
```

---

## 2. Self-hosted facilitator (Docker)

`apps/facilitator-docker` is the same facilitator core as `facilitator-api`,
packaged as a Node container so anyone can run their own.

```bash
docker build -f apps/facilitator-docker/Dockerfile -t x402cloud-facilitator .
docker run --rm -p 3000:3000 \
  -e FACILITATOR_PRIVATE_KEY=0x... \
  -e RPC_URL=https://mainnet.base.org \
  -e NETWORK=eip155:8453 \
  x402cloud-facilitator
```

See `apps/facilitator-docker/README.md` for the full env-var table and
endpoints. Point any middleware at `http://your-host:3000`.

---

## 3. ACP seller

`apps/acp-seller` is a long-running Node process that registers offerings
with the Virtuals ACP marketplace and serves jobs through Cloudflare
Workers AI.

```bash
docker build -f apps/acp-seller/Dockerfile -t x402cloud-acp-seller apps/acp-seller
docker run --rm \
  -e CF_ACCOUNT_ID=... \
  -e CF_API_TOKEN=... \
  x402cloud-acp-seller
```

The container expects credentials with the *Workers AI* template. Deploy
to any container host (Railway, Fly, your own server) — there is no HTTP
ingress; ACP polls the seller.

---

## 4. Static site

`site/` is plain HTML. Push to Cloudflare Pages or any static host:

```bash
pnpm -F site exec wrangler pages deploy . --project-name x402cloud
```

---

## 5. Goldsky indexer

`apps/x402-indexer` is a pipeline definition (`config.yaml`,
`pipeline.yaml`, `schema.graphql`) deployed via the Goldsky CLI, not run
locally.

```bash
goldsky pipeline apply apps/x402-indexer/pipeline.yaml
```

---

## Secrets checklist

| Where | Secret | Purpose |
|---|---|---|
| `facilitator-api` | `FACILITATOR_PRIVATE_KEY` | Pays gas for settlement |
| `facilitator-api` | `FACILITATOR_API_TOKEN` | Bearer auth for `/verify`, `/settle` |
| `facilitator-docker` | `FACILITATOR_PRIVATE_KEY`, `RPC_URL`, optional `FACILITATOR_API_TOKEN` | Same |
| `indexer` | `BASE_RPC_URL`, `BASE_SEPOLIA_RPC_URL` | Optional private RPCs |
| `status` | `TESTNET_RPC_URL`, `MAINNET_RPC_URL` | Optional private RPCs |
| `status` | `OPERATOR_ADDRESS` | Optional override for the USDC-balance probe |
| `status` | `ALERT_WEBHOOK_URL` | Optional — cron alert POST target (ntfy.sh-style) |
| `acp-seller` | `CF_ACCOUNT_ID`, `CF_API_TOKEN` | CF Workers AI |

`.env` files are gitignored. Never commit private keys; use
`wrangler secret put` for Workers and your container platform's secret
manager for Docker.

---

## Workers Builds — Git-connected deploys (no API keys)

Each Worker connects to this repo via Cloudflare's native Git integration:
push to `main` deploys production, and every PR gets a build with a
[preview URL](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
commented on the PR. No tokens live in GitHub — Cloudflare generates and
holds its own deploy token per project when you connect. Existing Worker
secrets (set via `wrangler secret put`) persist across these deploys.

**Connecting is dashboard-only** (wrangler has no command for it), one time
per Worker: dash.cloudflare.com (x402cloud account) → **Workers & Pages** →
select the Worker → **Settings → Builds → Connect**. First time, GitHub will
prompt to install the *Cloudflare Workers and Pages* app on the `x402cloud`
org — grant it this repo only.

Use these settings for every Worker (only the root directory differs):

| Setting | Value |
|---|---|
| Repository | `x402cloud/x402cloud` |
| Production branch | `main` |
| Root directory | `apps/<app>` (see table below) |
| Build command | `pnpm run -w build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch command | `npx wrangler versions upload` (default) |
| Build watch paths — include | `apps/<app>/**`, `packages/**`, `pnpm-lock.yaml` |

The build command runs turbo at the workspace root so `@x402cloud/*`
packages build first; the deploy runs in the app directory so wrangler picks
up the right `wrangler.toml` (the dashboard Worker name must match its
`name` field — table below). Watch paths stop the other six Workers from
rebuilding on unrelated commits.

| Root directory | Dashboard Worker name (`wrangler.toml` name) | Notes |
|---|---|---|
| `apps/facilitator-api` | `x402cloud-facilitator` | live — secrets already set, untouched by builds |
| `apps/infer` | `infer-x402cloud` | live |
| `apps/status` | `x402cloud-status` | live |
| `apps/indexer` | `x402cloud-indexer` | live; crons do not fire on PR preview versions |
| `apps/marketplace` | `x402cloud-marketplace` | connect when ready |
| `apps/sandbox` | `x402cloud-sandbox` | connect when ready |
| `apps/scrape` | `x402cloud-scrape` | connect when ready |

`site/` (Pages) stays on manual `wrangler pages deploy`: Pages Git
integration cannot be added to an existing direct-upload project — adding it
would mean recreating the Pages project. Do that separately if wanted.

`.github/workflows/ci.yml` runs `pnpm build`, `pnpm typecheck`, and unit
tests on every PR. E2E tests run against Base Sepolia on pushes to `main`
using `TEST_PRIVATE_KEY` and `FACILITATOR_PRIVATE_KEY` repository secrets.

NPM publishing is performed by `.github/workflows/release.yml` when a
version tag of the form `v*` is pushed (see `CHANGELOG.md`).
