# @x402cloud/probes

Health and readiness probes for x402cloud services.

A small library of pure async functions (`(target) => Promise<ProbeResult>`) that
check whether a network's RPC, USDC and Permit2 contracts, facilitator API, and
inference API are alive and behaving correctly. Used by `apps/status` and the
operational dashboards, but exported as a library so anyone can run the same
checks against their own deployment.

## Install

```bash
pnpm add @x402cloud/probes
```

## Usage

```typescript
import {
  allProbes,
  runProbes,
  rpcAlive,
  facilitatorHealth,
  type Target,
} from "@x402cloud/probes";

const target: Target = {
  name: "base-sepolia",
  rpc: "https://sepolia.base.org",
  facilitator: "https://x402cloud.ai",
  infer: "https://infer.x402cloud.ai",
  network: "eip155:84532",
};

// Run a single probe
const result = await rpcAlive(target);
console.log(result); // { name: "rpc.alive", status: "pass", latencyMs: 42 }

// Run the full suite
const report = await runProbes(target, allProbes);
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

`allProbes` is the default list. You can compose your own array.

## Design

Each probe is a pure function that takes a `Target` and returns a `ProbeResult`.
Probes never throw — failures are returned as `{ status: "fail", error }`. The
`wrapProbe` helper handles timing and exception → result conversion so the body
of each probe can be straightforward. This keeps probes composable and testable
without any framework.

## License

MIT — see [LICENSE](../../LICENSE).
