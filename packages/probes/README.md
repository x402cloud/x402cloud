# @x402cloud/probes

Health and readiness probes for x402cloud infrastructure. A small library of pure async functions (`(target) => Promise<ProbeResult>`) that check whether a network's RPC, USDC and Permit2 contracts, facilitator API, and inference API are alive and behaving correctly. Used by the x402cloud status dashboards, and exported as a library (publishable, `publishConfig.access: "public"`) so anyone can run the same checks against their own deployment.

## Install

```bash
pnpm add @x402cloud/probes
```

## Usage

```ts
import {
  allProbes,
  runProbes,
  rpcAlive,
  TARGETS,
  type Target,
} from "@x402cloud/probes";

// Use a built-in target (local | testnet | mainnet)...
const target = TARGETS.testnet;

// ...or define your own
const custom: Target = {
  name: "my-deployment",
  rpc: "https://sepolia.base.org",
  facilitator: "https://facilitator.x402cloud.ai",
  infer: "https://infer.x402cloud.ai",
  network: "eip155:84532",
};

// Run a single probe
const result = await rpcAlive(target);
// { name: "rpc-alive", status: "pass", latencyMs: 42 }

// Run the full suite
const report = await runProbes(allProbes, target);
console.log(report.summary); // { pass, fail, warn, skip }
```

## Probes

| Probe | Checks |
|---|---|
| `rpcAlive` | RPC endpoint responds to `eth_chainId` |
| `usdcContract` | USDC contract has expected `name`/`symbol`/`decimals` |
| `permit2Contract` | Permit2 contract is deployed at the canonical address |
| `facilitatorHealth` | Facilitator `/health` returns 200 |
| `inferHealth` | Inference API `/health` returns 200 |
| `inferModels` | Inference API `/models` lists at least one model |
| `paymentFlow` | End-to-end signing + verify works against the facilitator |
| `gasEstimate` | Facilitator wallet has enough native token to pay gas |
| `usdcBalance` | Operator/revenue address's USDC balance (informational — no threshold) |

`allProbes` is the default list. You can compose your own array — probes targeting a service the target doesn't define (e.g. `infer: null`) return `status: "skip"`.

## Design

Each probe is a pure function that takes a `Target` and returns a `ProbeResult`. Probes never throw — failures are returned as `{ status: "fail", error }`. The `wrapProbe(name, body, timeoutMs?)` helper handles timing, a 10s default timeout via `AbortSignal`, and exception-to-result conversion, so the body of each probe stays straightforward. This keeps probes composable and testable without any framework.

`resolveFacilitatorAddress(target, signal)` is the one place "what is the facilitator's wallet address" is resolved — an explicit `Target.facilitatorAddress` override, or a live `/supported` lookup. Both `gasEstimate` and `usdcBalance` call it, so the lookup can't drift between the two.

## Settlement health

`summarizeSettlements(kv, opts?)` turns a paid service's durable settlement
records (e.g. `apps/infer`'s `SETTLEMENTS` KV — see its `src/recorder.ts`)
into a windowed pass/fail rollup: `{ available, windowHours, settled, failed,
pending, total, truncated }`. It takes a minimal structural `KVList`
interface (`list` + `get`, read-only — never `put`), and degrades to
`{ available: false }` with no network call when no KV binding is given, so
a consumer without the binding wired never fabricates or errors. Not
included in `allProbes` because it isn't `Target`-based (it reads one
account-wide KV namespace, not a per-network URL).

## Exports

**Functions:** `runProbes`, `wrapProbe`, `rpcAlive`, `usdcContract`, `permit2Contract`, `facilitatorHealth`, `inferHealth`, `inferModels`, `paymentFlow`, `gasEstimate`, `usdcBalance`, `resolveFacilitatorAddress`, `summarizeSettlements`

**Constants:** `allProbes`, `TARGETS`

**Types:** `Probe`, `ProbeResult`, `ProbeReport`, `ProbeStatus`, `Target`, `AddressLookup`, `SettlementSummary`, `KVList`

## License

MIT — part of [x402cloud](https://github.com/x402cloud/x402cloud)
