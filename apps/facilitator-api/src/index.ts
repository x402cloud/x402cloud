import { Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createFacilitator, createFacilitatorRoutes, type Facilitator } from "@x402cloud/facilitator";
import type { Network } from "@x402cloud/protocol";
import { CHAINS } from "@x402cloud/evm";
import { landingPageHtml } from "./html.js";

type Bindings = {
  FACILITATOR_PRIVATE_KEY: string;
  FACILITATOR_API_TOKEN: string;
  RPC_URL: string;
  NETWORK: string;
  OUR_ADDRESS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Standard HTTP hardening: HSTS, no MIME sniffing, no framing.
app.use("/*", secureHeaders({
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
  referrerPolicy: "no-referrer",
}));

/**
 * Lazily-created facilitator. Cloudflare Workers cannot run async code at
 * module top level, and the env bindings only become available inside a
 * request handler. This is the documented exception to the immutability
 * rule in CLAUDE.md ("no hidden state, no singletons"): the value is
 * write-once on first request and treated as a value thereafter.
 */
let facilitator: Facilitator | null = null;

function getFacilitator(env: Bindings): Facilitator {
  if (!facilitator) {
    const network = env.NETWORK as Network;
    const chain = CHAINS[network];
    if (!chain) {
      throw new Error(`Unsupported network: ${network}. Supported: ${Object.keys(CHAINS).join(", ")}`);
    }
    facilitator = createFacilitator({
      privateKey: env.FACILITATOR_PRIVATE_KEY as `0x${string}`,
      rpcUrl: env.RPC_URL,
      network,
      chain,
    });
  }
  return facilitator;
}

// ── Info ─────────────────────────────────────────────────────────────
app.get("/", (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("text/html")) {
    return c.html(landingPageHtml(c.env));
  }

  return c.json({
    name: "facilitator.x402cloud.ai",
    description: "x402 protocol facilitator — verify and settle USDC payments on-chain using the x402 standard",
    docs: "https://facilitator.x402cloud.ai/llms.txt",
    health: "https://facilitator.x402cloud.ai/health",
    supported_url: "https://facilitator.x402cloud.ai/supported",
    payment: "x402 exact + upto (USDC on Base)",
    facilitator: c.env.OUR_ADDRESS,
    network: c.env.NETWORK,
    endpoints: {
      "/health": { method: "GET", auth: false, description: "Health check" },
      "/supported": { method: "GET", auth: false, description: "Supported schemes, networks, and facilitator address" },
      "/verify": { method: "POST", auth: true, description: "Verify an upto payment payload" },
      "/settle": { method: "POST", auth: true, description: "Settle an upto payment on-chain" },
      "/verify-exact": { method: "POST", auth: true, description: "Verify an exact payment payload" },
      "/settle-exact": { method: "POST", auth: true, description: "Settle an exact payment on-chain" },
    },
  });
});

app.get("/llms.txt", (c) => {
  return c.text(`# facilitator.x402cloud.ai

x402 payment facilitator — verify and settle USDC micropayments on-chain.

## What This Is

A hosted facilitator service for the x402 payment protocol. It verifies Permit2-signed USDC payments and settles them on-chain. Used by x402 middleware to handle payment verification without servers needing private keys.

Supports both exact (fixed-price) and upto (metered) payment schemes.

## Self-Host

This facilitator is also available as a Docker image for self-hosting:
docker run -e FACILITATOR_PRIVATE_KEY=0x... -e RPC_URL=https://mainnet.base.org -e NETWORK=eip155:8453 -p 3000:3000 ghcr.io/x402cloud/facilitator

## Network

- Network: ${c.env.NETWORK}
- Facilitator address: ${c.env.OUR_ADDRESS}
- Token: USDC
- Schemes: exact, upto

## Endpoints

### GET /health
Health check. Returns {"status":"ok"}.

### GET /supported
Returns supported schemes, networks, and facilitator address. No auth required.

### POST /verify (auth required)
Verify an upto payment payload against requirements.
Request body:
\`\`\`json
{ "payload": { ... }, "requirements": { ... } }
\`\`\`
Returns: { "isValid": true } or { "isValid": false, "invalidReason": "..." }

### POST /settle (auth required)
Settle an upto payment on-chain.
Request body:
\`\`\`json
{ "payload": { ... }, "requirements": { ... }, "settlementAmount": "1000000" }
\`\`\`
Returns: { "success": true, "txHash": "0x..." } or { "success": false, "errorReason": "..." }

### POST /verify-exact (auth required)
Verify an exact (fixed-price) payment payload against requirements.
Request body:
\`\`\`json
{ "payload": { ... }, "requirements": { ... } }
\`\`\`
Returns: { "isValid": true } or { "isValid": false, "invalidReason": "..." }

### POST /settle-exact (auth required)
Settle an exact payment on-chain (full authorized amount).
Request body:
\`\`\`json
{ "payload": { ... }, "requirements": { ... } }
\`\`\`
Returns: { "success": true, "txHash": "0x..." } or { "success": false, "errorReason": "..." }

## Integration

Servers use @x402cloud/middleware with a facilitator URL:
\`\`\`typescript
import { remoteExactPaymentMiddleware } from "@x402cloud/middleware";
app.use("/*", remoteExactPaymentMiddleware(routes, "https://facilitator.x402cloud.ai"));
\`\`\`

The middleware calls /verify-exact on each request and /settle-exact after successful responses.

## Source

https://github.com/x402cloud/x402cloud
`);
});

// ── Health ───────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/robots.txt", (c) => c.text(`User-agent: *\nAllow: /\n\nSitemap: https://facilitator.x402cloud.ai/sitemap.xml\n`));

app.get("/sitemap.xml", (c) => {
  const urls = ["/", "/health", "/supported", "/llms.txt", "/.well-known/agent-card.json"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>https://facilitator.x402cloud.ai${u}</loc></url>`).join("\n")}
</urlset>`;
  return c.body(xml, 200, { "Content-Type": "application/xml" });
});

app.get("/.well-known/agent-card.json", (c) => {
  return c.json({
    name: "facilitator.x402cloud.ai",
    description: "x402 protocol facilitator — verify and settle USDC payments on-chain using the x402 standard",
    url: "https://facilitator.x402cloud.ai",
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      { id: "verify", name: "Verify Upto Payment", description: "Verify an upto payment payload" },
      { id: "settle", name: "Settle Upto Payment", description: "Settle an upto payment on-chain via Permit2" },
      { id: "verify-exact", name: "Verify Exact Payment", description: "Verify an exact (fixed-price) payment payload" },
      { id: "settle-exact", name: "Settle Exact Payment", description: "Settle an exact payment on-chain via Permit2" },
    ],
    authentication: { schemes: ["bearer"] },
    documentationUrl: "https://facilitator.x402cloud.ai/llms.txt",
    provider: { organization: "x402cloud.ai", url: "https://x402cloud.ai" },
  });
});

app.get("/.well-known/api-catalog", (c) => {
  return c.json({
    linkset: [{
      anchor: "https://facilitator.x402cloud.ai/",
      "service-desc": [{ href: "https://facilitator.x402cloud.ai/llms.txt", type: "text/plain" }],
      "service-doc": [{ href: "https://facilitator.x402cloud.ai/llms.txt", type: "text/plain" }],
    }],
  });
});

// ── Supported ────────────────────────────────────────────────────────
app.get("/supported", (c) => {
  return c.json({
    schemes: ["exact", "upto"],
    networks: [c.env.NETWORK],
    facilitator: c.env.OUR_ADDRESS,
  });
});

// ── Auth + init middleware for protected endpoints ────────────────────
/**
 * Fail-closed auth gate for payment routes. Combines:
 *   1. Configuration check — refuse 500 if FACILITATOR_API_TOKEN is unset,
 *      so a misconfigured deployment never serves payment endpoints
 *      unauthenticated.
 *   2. Bearer-token check with a constant-time comparison.
 *   3. Lazy facilitator initialization (Workers can't run async at module
 *      level — see CLAUDE.md "Worker lazy init" exception).
 *
 * Bound directly to the routes via `createFacilitatorRoutes({ auth })` so the
 * mount site cannot accidentally omit it.
 */
const protectPaymentRoute: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (!c.env.FACILITATOR_API_TOKEN) {
    return c.json({ error: "facilitator_misconfigured" }, 500);
  }
  const auth = c.req.header("Authorization");
  if (!auth) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const expected = `Bearer ${c.env.FACILITATOR_API_TOKEN}`;
  const encoder = new TextEncoder();
  const a = encoder.encode(auth);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength || !(await crypto.subtle.timingSafeEqual(a, b))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  getFacilitator(c.env);
  await next();
};

// ── Payment routes (shared) ──────────────────────────────────────────
app.route(
  "/",
  createFacilitatorRoutes(() => facilitator!, {
    auth: protectPaymentRoute as MiddlewareHandler,
  }),
);

export default app;
