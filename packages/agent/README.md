# @x402cloud/agent

Agent SDK for the x402cloud marketplace — discover services and auto-pay for them in one import. Wraps `@x402cloud/client` with catalog lookup and optional budget caps, so an agent can go from "I need a scraper" to a paid JSON response in three lines.

Publishable workspace package (`publishConfig.access: "public"`); `viem` is a peer dependency.

## Install

```bash
pnpm add @x402cloud/agent
```

## Usage

```ts
import { createAgentClient } from "@x402cloud/agent";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);

const agent = createAgentClient({
  signer: {
    address: account.address,
    signTypedData: (params) => account.signTypedData(params as never),
  },
  budget: { perCall: "$0.10", perDay: "$5" }, // optional caps
});

// Browse the marketplace
const services = await agent.discover({ category: "inference", q: "fast" });

// One-line paid call: catalog lookup + Permit2 signing + 402 retry + JSON parse
const result = await agent.call("infer-fast", {
  messages: [{ role: "user", content: "Hello" }],
});

// Or get a fetch that auto-pays for a known service
const payingFetch = await agent.fetchFor("infer-fast");
```

`call()` pre-checks the budget against the service's worst-case `maxPrice`, then records the *actual* settled amount from the `X-Payment-Settled` header — so per-day caps track real spend, not authorizations.

## Budget tracking

The built-in tracker is in-memory per-process (fine for one-shot CLIs). For multi-instance deployments (e.g. Workers), implement `BudgetTracker` over your own storage and pass it as `tracker`:

```ts
import { createBudgetTracker, parsePriceUsd, microUsdcToUsd } from "@x402cloud/agent";
import type { BudgetTracker } from "@x402cloud/agent";

const tracker: BudgetTracker = createBudgetTracker(
  { perCall: "$0.10", perDay: "$5" },
  myKvBackedStore, // your persistence
);
```

`agent.call()` throws `BudgetExceededError` when a cap would be exceeded and `ServiceNotFoundError` for unknown service ids.

## Configuration

```ts
const agent = createAgentClient({
  signer,                                       // Required: ClientSigner (address + signTypedData)
  catalogUrl: "https://marketplace.x402cloud.ai", // Optional: marketplace base URL (default shown)
  budget: { perCall: "$0.10", perDay: "$5" },   // Optional: in-memory caps
  tracker,                                       // Optional: custom BudgetTracker (wins over budget)
  fetch: myFetch,                                // Optional: override fetch (testing)
});
```

## Exports

**Functions:** `createAgentClient`, `fetchCatalog`, `fetchService`, `createInMemoryBudgetTracker`, `createBudgetTracker`, `parsePriceUsd`, `microUsdcToUsd`, `dayKey`

**Errors:** `BudgetExceededError`, `ServiceNotFoundError`

**Types:** `AgentClient`, `AgentClientOptions`, `Budget`, `BudgetTracker`, `DiscoverFilter`, `MarketplaceService`

## License

MIT — part of [x402cloud](https://github.com/x402cloud/x402cloud)
