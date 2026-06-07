import { Hono } from "hono";
import type { Catalog, MarketplaceService, Network } from "@x402cloud/protocol";
import type { ServiceMeta, ServiceRoute } from "@x402cloud/discovery";
import {
  buildAgentsJson,
  buildApiCatalog,
  buildOpenApi,
  buildRobotsTxt,
  buildSitemapXml,
  defaultSitemapPaths,
} from "@x402cloud/discovery";
import { buildCatalog } from "./catalog.js";

type Env = {
  Bindings: {
    NETWORK: string;
    FACILITATOR_URL: string;
    OPERATOR_ADDRESS: string;
  };
};

const VERSION = "0.1.0";

/**
 * Catalog is a pure projection of env vars. Cache it per-env-key so identical
 * config returns the same value object (and same `generatedAt`). The Worker
 * can then serve the same JSON every request — and edge caches can do the
 * same. `generatedAt` is the build moment, not the read moment.
 */
const catalogCache = new Map<string, Catalog>();

function getCatalog(env: Env["Bindings"]): Catalog {
  const key = `${env.NETWORK}|${env.OPERATOR_ADDRESS}|${env.FACILITATOR_URL}`;
  const cached = catalogCache.get(key);
  if (cached) return cached;

  const network = env.NETWORK as Network;
  const services = buildCatalog({
    network,
    operatorAddress: env.OPERATOR_ADDRESS,
    facilitator: env.FACILITATOR_URL,
  });
  const catalog: Catalog = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    operator: {
      name: "x402cloud.ai",
      url: "https://x402cloud.ai",
      payTo: env.OPERATOR_ADDRESS,
    },
    services,
  };
  catalogCache.set(key, catalog);
  return catalog;
}

/** Cache catalog responses at the edge for a minute. Catalog only changes on deploy. */
const CATALOG_CACHE_CONTROL = "public, max-age=60, s-maxage=60";

function filterServices(
  services: MarketplaceService[],
  q: string | undefined,
  category: string | undefined,
  tag: string | undefined,
): MarketplaceService[] {
  let out = services;
  if (category) out = out.filter((s) => s.category === category);
  if (tag) out = out.filter((s) => s.tags.includes(tag));
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter(
      (s) =>
        s.id.toLowerCase().includes(needle) ||
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle) ||
        s.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }
  return out;
}

const app = new Hono<Env>();

app.get("/health", (c) => c.json({ status: "ok", version: VERSION }));

app.get("/services", (c) => {
  const catalog = getCatalog(c.env);
  const services = filterServices(
    catalog.services,
    c.req.query("q"),
    c.req.query("category"),
    c.req.query("tag"),
  );
  c.header("Cache-Control", CATALOG_CACHE_CONTROL);
  return c.json({ ...catalog, services });
});

app.get("/services/:id", (c) => {
  const id = c.req.param("id");
  const catalog = getCatalog(c.env);
  const service = catalog.services.find((s) => s.id === id);
  if (!service) return c.json({ error: `Unknown service: ${id}` }, 404);
  c.header("Cache-Control", CATALOG_CACHE_CONTROL);
  return c.json(service);
});

app.get("/categories", (c) => {
  const catalog = getCatalog(c.env);
  const counts: Record<string, number> = {};
  for (const s of catalog.services) counts[s.category] = (counts[s.category] ?? 0) + 1;
  return c.json({ categories: counts });
});

// A2A discovery
app.get("/.well-known/agent-card.json", (c) => {
  const catalog = getCatalog(c.env);
  return c.json({
    name: "x402cloud marketplace",
    description: "Discovery API for x402-paid agent services. Lists every service in the x402cloud catalog with payment requirements, schemas, and examples.",
    url: "https://marketplace.x402cloud.ai",
    version: VERSION,
    protocol: "a2a",
    capabilities: { streaming: false, pushNotifications: false },
    authentication: {
      schemes: ["none"],
      description: "Discovery is free. Individual services are paid via x402.",
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "list-services",
        name: "List services",
        description: "Returns the full catalog of x402-paid services.",
        tags: ["discovery", "catalog"],
        examples: ["GET https://marketplace.x402cloud.ai/services"],
      },
      {
        id: "filter-services",
        name: "Filter services",
        description: "Filter catalog by category, tag, or text query.",
        tags: ["discovery", "search"],
        examples: [
          "GET https://marketplace.x402cloud.ai/services?category=inference",
          "GET https://marketplace.x402cloud.ai/services?tag=llm",
          "GET https://marketplace.x402cloud.ai/services?q=python",
        ],
      },
    ],
  });
});

app.get("/llms.txt", (c) => {
  const catalog = getCatalog(c.env);
  const lines = [
    "# x402cloud marketplace",
    "",
    "Discovery API for x402-paid agent services. Every service accepts USDC via the x402 protocol.",
    "",
    "## How to use",
    "",
    "1. GET /services to list everything",
    "2. POST to a service's `endpoint.url` — you'll receive 402 with payment requirements",
    "3. Sign the upto authorization with `@x402cloud/client` and resend",
    "4. Server settles for actual usage (always ≤ maxPrice)",
    "",
    `## Network: ${c.env.NETWORK}`,
    `## Operator wallet: ${c.env.OPERATOR_ADDRESS}`,
    `## Facilitator: ${c.env.FACILITATOR_URL}`,
    "",
    "## Services",
    "",
  ];
  for (const s of catalog.services) {
    lines.push(`### ${s.id} — ${s.name}`);
    lines.push(`${s.description}`);
    lines.push(`POST ${s.endpoint.url}`);
    lines.push(`Max price: ${s.payment.maxPrice}`);
    lines.push(`Tags: ${s.tags.join(", ")}`);
    lines.push("");
  }
  return c.text(lines.join("\n"));
});

// --- Standard discovery surface (openapi, agents.json, sitemap, robots, api-catalog) ---
// llms.txt and agent-card remain bespoke above — they project the live catalog,
// not a fixed route table.

const MARKETPLACE_BASE_URL = "https://marketplace.x402cloud.ai";

const DISCOVERY_META: ServiceMeta = {
  name: "marketplace.x402cloud.ai",
  description: "Discovery API for x402-paid agent services. Lists every service in the x402cloud catalog with payment requirements, schemas, and examples.",
  baseUrl: MARKETPLACE_BASE_URL,
  version: VERSION,
};

const DISCOVERY_ROUTES: ServiceRoute[] = [
  { path: "/services", method: "GET", summary: "List all marketplace services", tags: ["discovery"] },
  { path: "/services/{id}", method: "GET", summary: "Fetch a single service by id", tags: ["discovery"] },
  { path: "/categories", method: "GET", summary: "Service category counts", tags: ["discovery"] },
  { path: "/llms.txt", method: "GET", summary: "LLM-readable catalog", tags: ["discovery"], responseContentType: "text/plain", responseSchema: { type: "string" } },
];

const SITEMAP_PATHS = defaultSitemapPaths(DISCOVERY_ROUTES);

app.get("/openapi.json", (c) => c.json(buildOpenApi(DISCOVERY_META, DISCOVERY_ROUTES)));
app.get("/agents.json", (c) => c.json(buildAgentsJson(DISCOVERY_META, DISCOVERY_ROUTES)));
app.get("/robots.txt", (c) => c.text(buildRobotsTxt(MARKETPLACE_BASE_URL)));
app.get("/sitemap.xml", (c) =>
  c.text(buildSitemapXml(MARKETPLACE_BASE_URL, SITEMAP_PATHS), 200, {
    "Content-Type": "application/xml",
  }),
);
app.get("/.well-known/api-catalog", (c) => c.json(buildApiCatalog(DISCOVERY_META)));

app.get("/", (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (!accept.includes("text/html")) {
    return c.json(getCatalog(c.env));
  }
  const catalog = getCatalog(c.env);
  const rows = catalog.services
    .map(
      (s) =>
        `<tr><td><code>${s.id}</code></td><td>${s.category}</td><td>${s.name}</td><td>${s.payment.maxPrice}</td><td><code>${s.endpoint.url}</code></td></tr>`,
    )
    .join("\n");
  return c.html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>marketplace.x402cloud.ai</title>
<style>
body{font-family:-apple-system,sans-serif;background:#060606;color:#d4d4d4;max-width:1000px;margin:0 auto;padding:40px 24px;line-height:1.6}
h1{color:#ececec;font-size:32px;margin:0 0 8px}
.sub{color:#8a8a8a;margin-bottom:32px}
table{width:100%;border-collapse:collapse;font-size:13px;border:1px solid #222}
th{text-align:left;padding:10px 14px;background:#0a0a0a;color:#8a8a8a;text-transform:uppercase;font-size:11px;letter-spacing:0.08em;border-bottom:1px solid #222}
td{padding:8px 14px;border-bottom:1px solid #222}
code{font-family:"SF Mono",monospace;font-size:12px;color:#ececec}
a{color:#8a8a8a}a:hover{color:#ececec}
.links{margin-bottom:24px}.links a{margin-right:16px;font-family:monospace;font-size:12px}
</style></head><body>
<h1>x402cloud marketplace</h1>
<p class="sub">Discovery API for x402-paid agent services. ${catalog.services.length} services live.</p>
<div class="links">
<a href="/services">GET /services</a>
<a href="/llms.txt">llms.txt</a>
<a href="/.well-known/agent-card.json">agent-card</a>
<a href="https://x402cloud.ai">x402cloud.ai</a>
</div>
<table>
<tr><th>ID</th><th>Category</th><th>Name</th><th>Max Price</th><th>Endpoint</th></tr>
${rows}
</table>
</body></html>`);
});

export default app;
