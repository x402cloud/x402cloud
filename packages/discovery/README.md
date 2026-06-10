# @x402cloud/discovery

Pure builders for x402 discovery surfaces — describe a service once and generate `openapi.json`, `agents.json`, `llms.txt`, `robots.txt`, `sitemap.xml`, the A2A agent-card, and the `.well-known/api-catalog` from the same data. Zero runtime dependencies; `hono` is an optional peer dependency for the one-call adapter.

Publishable workspace package (`publishConfig.access: "public"`).

## Install

```bash
pnpm add @x402cloud/discovery
```

## Usage

### Mount everything on a Hono app

```ts
import { Hono } from "hono";
import { mountDiscovery } from "@x402cloud/discovery/hono";
import type { ServiceMeta, ServiceRoute } from "@x402cloud/discovery";

const meta: ServiceMeta = {
  name: "infer.x402cloud.ai",
  description: "Pay-per-call AI inference over x402",
  baseUrl: "https://infer.x402cloud.ai",
};

const routes: ServiceRoute[] = [
  {
    path: "/fast",
    method: "POST",
    summary: "Fast chat completion",
    payment: { maxPrice: "$0.002", network: "Base (USDC)" }, // presence => paid route
    requestSchema: { type: "object", properties: { messages: { type: "array" } } },
  },
  { path: "/health", method: "GET", summary: "Health check" }, // no payment => free
];

const app = new Hono();
mountDiscovery(app, meta, routes);
// Serves: /openapi.json, /agents.json, /llms.txt, /robots.txt, /sitemap.xml,
//         /.well-known/agent-card.json, /.well-known/api-catalog
```

### Use the pure builders directly

Each builder takes plain data in and returns plain data out — no Response, no Hono, no Worker types — so they work with any framework:

```ts
import {
  buildOpenApi,
  buildAgentCard,
  buildAgentsJson,
  buildLlmsTxt,
  buildApiCatalog,
  buildSitemapXml,
  buildRobotsTxt,
  routeToSkill,
  defaultSitemapPaths,
} from "@x402cloud/discovery";

const openapi = buildOpenApi(meta, routes);          // paid routes get x-x402 + 402 response
const card = buildAgentCard(meta, routes.filter((r) => r.payment).map(routeToSkill));
const llms = buildLlmsTxt(meta, routes);             // string
const sitemap = buildSitemapXml(meta.baseUrl, defaultSitemapPaths(routes)); // string
```

### Options

```ts
mountDiscovery(app, meta, routes, {
  skills,        // override agent-card skills (default: one per paid route)
  sitemapPaths,  // override sitemap paths (default: defaultSitemapPaths(routes))
  facilitator,   // facilitator URL surfaced in openapi.json#x-x402
});
```

## Exports

**Builders (`.`):** `buildAgentCard`, `buildOpenApi`, `buildAgentsJson`, `buildLlmsTxt`, `buildApiCatalog`, `buildSitemapXml`, `buildRobotsTxt`, `routeToSkill`, `defaultSitemapPaths`

**Hono adapter (`./hono`):** `mountDiscovery`

**Types:** `ServiceMeta`, `ServiceRoute`, `ServiceSkill`, `PaymentInfo`, `MountDiscoveryOptions`

## License

MIT — part of [x402cloud](https://github.com/x402cloud/x402cloud)
