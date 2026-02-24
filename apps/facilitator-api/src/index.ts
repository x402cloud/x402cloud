import { Hono } from "hono";
import { createFacilitator, type Facilitator } from "@x402cloud/facilitator";
import type { Network, PaymentRequirements } from "@x402cloud/protocol";
import { CHAINS, type UptoPayload, type ExactPayload } from "@x402cloud/evm";

type Bindings = {
  FACILITATOR_PRIVATE_KEY: string;
  FACILITATOR_API_TOKEN: string;
  RPC_URL: string;
  NETWORK: string;
  OUR_ADDRESS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

/** Lazily-created facilitator (avoids module-level async) */
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
    return c.html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>facilitator.x402cloud.ai — x402 Protocol Facilitator</title>
<meta name="description" content="x402 protocol facilitator — verify and settle USDC payments on-chain using the x402 standard.">
<meta property="og:title" content="facilitator.x402cloud.ai"><meta property="og:description" content="x402 protocol facilitator — verify and settle USDC payments on-chain using the x402 standard.">
<meta property="og:image" content="https://x402cloud.ai/og.png"><meta name="twitter:card" content="summary_large_image">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#060606;--surface:#0a0a0a;--border:#222;--bd:#2a2a2a;--text:#d4d4d4;--bright:#ececec;--mid:#8a8a8a;--dim:#555;--mono:"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;--sans:"Inter",-apple-system,sans-serif}
body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased;font-size:15px}
a{color:inherit;text-decoration:none}a:hover{color:var(--bright)}
nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(6,6,6,0.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
nav .inner{max-width:1080px;margin:0 auto;padding:0 32px;height:52px;display:flex;align-items:center;justify-content:space-between}
.wordmark{font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:0.04em;color:var(--bright)}
.nav-links{display:flex;gap:24px}
.nav-links a{font-family:var(--mono);font-size:12px;color:var(--mid);letter-spacing:0.02em;transition:color .15s}
.nav-links a:hover{color:var(--bright)}
.w{max-width:900px;margin:0 auto;padding:80px 32px;padding-top:100px}
h1{font-size:36px;font-weight:700;color:var(--bright);letter-spacing:-0.03em;margin-bottom:8px}
.sub{font-size:17px;color:var(--mid);margin-bottom:40px}
.links{display:flex;gap:16px;margin-bottom:48px;flex-wrap:wrap}
.links a{font-family:var(--mono);font-size:12px;color:var(--mid);border:1px solid var(--border);padding:6px 14px;transition:all .15s}
.links a:hover{color:var(--bright);border-color:var(--dim)}
h2{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--dim);margin-bottom:16px;margin-top:48px}
table{width:100%;border-collapse:collapse;border:1px solid var(--border);font-size:13px}
th{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);text-align:left;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface)}
td{padding:10px 16px;border-bottom:1px solid var(--border);color:var(--mid)}
td:first-child{color:var(--bright)}
code{font-family:var(--mono);font-size:12px}
.code-block{background:var(--surface);border:1px solid var(--border);padding:20px;font-family:var(--mono);font-size:12.5px;line-height:2;color:var(--mid);overflow-x:auto;margin-bottom:24px;white-space:pre}
.info{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);margin-bottom:24px}
.info-item{padding:16px 20px;border-right:1px dashed var(--bd);border-bottom:1px dashed var(--bd)}
.info-item:nth-child(2n){border-right:none}
.info-label{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin-bottom:4px}
.info-value{font-size:14px;color:var(--bright)}
.tag{display:inline-block;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:2px 8px;border:1px solid var(--bd);color:var(--dim);margin-left:8px}
.tag.yes{color:var(--mid);border-color:var(--dim)}
footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--border);font-family:var(--mono);font-size:12px;color:var(--dim);display:flex;gap:24px}
footer a{color:var(--dim);transition:color .15s}footer a:hover{color:var(--mid)}
@media(max-width:600px){.w{padding:48px 20px;padding-top:80px}h1{font-size:28px}.info{grid-template-columns:1fr}.info-item{border-right:none}nav .inner{padding:0 20px}}
</style></head><body>
<nav><div class="inner"><a href="https://x402cloud.ai" class="wordmark">x402cloud.ai</a><div class="nav-links"><a href="https://x402cloud.ai/#services">Services</a><a href="https://x402cloud.ai/#packages">Packages</a><a href="https://status.x402cloud.ai">Status</a><a href="https://github.com/x402cloud/x402cloud">GitHub</a><a href="https://x402cloud.ai/llms.txt">Docs</a></div></div></nav>
<div class="w">
<h1>facilitator.x402cloud.ai</h1>
<p class="sub">x402 protocol facilitator — verify and settle USDC payments on-chain using the x402 standard (x402.org). Handles Permit2 verification and settlement so your server doesn't need private keys.</p>
<div class="links">
<a href="/health">Health</a>
<a href="/supported">Supported</a>
<a href="/llms.txt">llms.txt</a>
<a href="https://x402cloud.ai/llms.txt">Full Docs</a>
<a href="https://github.com/x402cloud/x402cloud">GitHub</a>
</div>

<div class="info">
<div class="info-item"><div class="info-label">Network</div><div class="info-value">${c.env.NETWORK}</div></div>
<div class="info-item"><div class="info-label">Address</div><div class="info-value"><code>${c.env.OUR_ADDRESS.slice(0, 6)}...${c.env.OUR_ADDRESS.slice(-4)}</code></div></div>
<div class="info-item"><div class="info-label">Token</div><div class="info-value">USDC</div></div>
<div class="info-item"><div class="info-label">Schemes</div><div class="info-value">exact + upto</div></div>
</div>

<h2>Endpoints</h2>
<table>
<tr><th>Endpoint</th><th>Method</th><th>Auth</th><th>Description</th></tr>
<tr><td><code>/</code></td><td>GET</td><td></td><td>Service info and endpoint listing</td></tr>
<tr><td><code>/health</code></td><td>GET</td><td></td><td>Health check</td></tr>
<tr><td><code>/supported</code></td><td>GET</td><td></td><td>Supported schemes, networks, facilitator address</td></tr>
<tr><td><code>/verify</code></td><td>POST</td><td><span class="tag yes">Bearer</span></td><td>Verify upto payment payload</td></tr>
<tr><td><code>/settle</code></td><td>POST</td><td><span class="tag yes">Bearer</span></td><td>Settle upto payment on-chain</td></tr>
<tr><td><code>/verify-exact</code></td><td>POST</td><td><span class="tag yes">Bearer</span></td><td>Verify exact payment payload</td></tr>
<tr><td><code>/settle-exact</code></td><td>POST</td><td><span class="tag yes">Bearer</span></td><td>Settle exact payment on-chain</td></tr>
</table>

<h2>Integration</h2>
<div class="code-block">import { remoteExactPaymentMiddleware } from "@x402cloud/middleware";

app.use("/*", remoteExactPaymentMiddleware({
  "POST /api": {
    network: "eip155:8453",
    price: "$0.01",
    payTo: "0xYOUR_ADDRESS",
  }
}, "https://facilitator.x402cloud.ai"));</div>

<h2>Self-Host</h2>
<div class="code-block">docker run -e FACILITATOR_PRIVATE_KEY=0x... \\
  -e RPC_URL=https://mainnet.base.org \\
  -e NETWORK=eip155:8453 \\
  -p 3000:3000 ghcr.io/x402cloud/facilitator</div>

<h2>How It Works</h2>
<table>
<tr><th>Step</th><th>Action</th><th>Who</th></tr>
<tr><td>1</td><td>Client sends request without payment</td><td>Agent</td></tr>
<tr><td>2</td><td>Middleware returns 402 with price and facilitator URL</td><td>Your server</td></tr>
<tr><td>3</td><td>Client signs Permit2 USDC authorization (off-chain)</td><td>Agent</td></tr>
<tr><td>4</td><td>Middleware sends payload to <code>/verify</code> or <code>/verify-exact</code></td><td>Facilitator</td></tr>
<tr><td>5</td><td>Server processes request</td><td>Your server</td></tr>
<tr><td>6</td><td>Middleware sends to <code>/settle</code> or <code>/settle-exact</code> — USDC moves on-chain</td><td>Facilitator</td></tr>
</table>

<footer>
<a href="https://x402cloud.ai">x402cloud.ai</a>
<a href="https://x402cloud.ai/llms.txt">docs</a>
<a href="https://github.com/x402cloud/x402cloud">github</a>
</footer>
</div></body></html>`);
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

// ── Auth middleware for protected endpoints ───────────────────────────
const authMiddleware = async (c: any, next: any) => {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${c.env.FACILITATOR_API_TOKEN}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

app.use("/verify", authMiddleware);
app.use("/settle", authMiddleware);
app.use("/verify-exact", authMiddleware);
app.use("/settle-exact", authMiddleware);

// ── Upto: Verify ────────────────────────────────────────────────────
app.post("/verify", async (c) => {
  const body = await c.req.json<{
    payload: UptoPayload;
    requirements: PaymentRequirements;
  }>();

  if (!body.payload || !body.requirements) {
    return c.json({ isValid: false, invalidReason: "missing payload or requirements" }, 400);
  }

  const f = getFacilitator(c.env);
  const result = await f.verify(body.payload, body.requirements);
  return c.json(result);
});

// ── Upto: Settle ────────────────────────────────────────────────────
app.post("/settle", async (c) => {
  const body = await c.req.json<{
    payload: UptoPayload;
    requirements: PaymentRequirements;
    settlementAmount: string;
  }>();

  if (!body.payload || !body.requirements || !body.settlementAmount) {
    return c.json({ success: false, errorReason: "missing payload, requirements, or settlementAmount" }, 400);
  }

  const f = getFacilitator(c.env);
  const result = await f.settle(body.payload, body.requirements, body.settlementAmount);
  return c.json(result);
});

// ── Exact: Verify ───────────────────────────────────────────────────
app.post("/verify-exact", async (c) => {
  const body = await c.req.json<{
    payload: ExactPayload;
    requirements: PaymentRequirements;
  }>();

  if (!body.payload || !body.requirements) {
    return c.json({ isValid: false, invalidReason: "missing payload or requirements" }, 400);
  }

  const f = getFacilitator(c.env);
  const result = await f.verifyExact(body.payload, body.requirements);
  return c.json(result);
});

// ── Exact: Settle ───────────────────────────────────────────────────
app.post("/settle-exact", async (c) => {
  const body = await c.req.json<{
    payload: ExactPayload;
    requirements: PaymentRequirements;
  }>();

  if (!body.payload || !body.requirements) {
    return c.json({ success: false, errorReason: "missing payload or requirements" }, 400);
  }

  const f = getFacilitator(c.env);
  const result = await f.settleExact(body.payload, body.requirements);
  return c.json(result);
});

export default app;
