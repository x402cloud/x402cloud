import { Hono, type MiddlewareHandler } from "hono";
import { createFacilitator, createFacilitatorRoutes, type Facilitator } from "@x402cloud/facilitator";
import type { Network, PaymentRequirements, SettleResponse } from "@x402cloud/protocol";
import type { UptoPayload, ExactPayload } from "@x402cloud/evm";
import { CHAINS } from "@x402cloud/evm";
import { landingPageHtml } from "./html.js";
import {
  durableObjectCoordinator,
  retrySettle,
  settleWithIdempotency,
  type RetryJob,
  type RetryQueue,
  type SettlementCoordinator,
  type SettlementDONamespace,
} from "./settlement-store.js";

// Re-export the Durable Object class so the Workers runtime can find it by name
// (wrangler.toml binds SETTLEMENT_DO -> class_name = "SettlementDO").
export { SettlementDO } from "./settlement-store.js";

type Bindings = {
  FACILITATOR_PRIVATE_KEY: string;
  FACILITATOR_API_TOKEN: string;
  RPC_URL: string;
  NETWORK: string;
  OUR_ADDRESS: string;
  /**
   * Durable Object namespace holding per-(scheme,nonce) settlement records. Each
   * instance is single-threaded with transactional storage, giving ATOMIC
   * read-modify-write — a hard exactly-once-recorded guarantee (no TOCTOU). This
   * is the default coordinator for the hosted worker.
   */
  SETTLEMENT_DO: SettlementDONamespace;
  /** Queue producer for transient-failure settlement retries. */
  SETTLE_QUEUE: { send(body: RetryJob): Promise<void> };
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

// ── Auth middleware for protected endpoints ───────────────────────────
/**
 * Bearer-token auth with a constant-time comparison.
 *
 * Returns 401 on missing header or mismatch. The explicit byte-length check
 * short-circuits `timingSafeEqual`, which throws when inputs differ in length
 * — preserving the constant-time property for same-length inputs (the only
 * case an attacker can force).
 */
const authMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
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
  await next();
};

app.use("/verify", authMiddleware);
app.use("/settle", authMiddleware);
app.use("/verify-exact", authMiddleware);
app.use("/settle-exact", authMiddleware);

// ── Ensure facilitator is initialized (Workers lazy init from env) ──
app.use("/verify", async (c, next) => { getFacilitator(c.env); await next(); });
app.use("/settle", async (c, next) => { getFacilitator(c.env); await next(); });
app.use("/verify-exact", async (c, next) => { getFacilitator(c.env); await next(); });
app.use("/settle-exact", async (c, next) => { getFacilitator(c.env); await next(); });

// ── Durable settle (idempotency + retry) ─────────────────────────────
//
// These two handlers are registered BEFORE the shared routes below, so they
// take precedence for /settle and /settle-exact while /verify and
// /verify-exact fall through to createFacilitatorRoutes unchanged.
//
// Why here and not in @x402cloud/facilitator: idempotency keying and retry
// enqueue are app/runtime concerns (KV + Queues). The pure settle logic stays
// in @x402cloud/evm; the pure transient/definitive classifier stays in
// @x402cloud/facilitator (isTransientFailure). This handler only orchestrates.

/** Build the injected coordinator + queue + confirm ports from the worker env. */
function settlementPorts(env: Bindings): {
  coordinator: SettlementCoordinator;
  queue: RetryQueue;
  confirm: (txHash: string, network: Network, settledAmount: string) => Promise<SettleResponse>;
} {
  const f = getFacilitator(env);
  return {
    // The hosted worker defaults to the Durable Object coordinator: each
    // (scheme,nonce) op is an atomic read-modify-write on a single-threaded DO,
    // closing the recorded-outcome races KV could only narrow.
    coordinator: durableObjectCoordinator(env.SETTLEMENT_DO),
    queue: { send: (job) => env.SETTLE_QUEUE.send(job) },
    confirm: (txHash, network, settledAmount) =>
      f.confirm(txHash as `0x${string}`, network, settledAmount),
  };
}

/** Map a durable-settle outcome onto an HTTP SettleResponse + status. */
function outcomeToResponse(
  outcome: Awaited<ReturnType<typeof settleWithIdempotency>>,
): { body: Record<string, unknown>; status: 200 | 202 } {
  switch (outcome.kind) {
    case "replayed":
    case "settled":
      // The recorded result (success or definitive failure) is returned as-is.
      return { body: outcome.result, status: 200 };
    case "in_flight":
      // Another attempt holds a valid lease — tell the caller it's pending, no
      // second on-chain submission was made.
      return { body: { success: false, errorReason: "settlement_in_flight", pending: true }, status: 202 };
    case "awaiting_confirmation":
      // A tx was broadcast but the receipt is unknown; a confirm job is queued.
      // NO re-broadcast happened. Surface the pending-receipt result.
      return {
        body: { ...outcome.result, pending: true, retryQueued: true },
        status: 202,
      };
    case "enqueued":
      // Transient broadcast failure: queued for retry. Surface failure + pending.
      return {
        body: { ...outcome.result, pending: true, retryQueued: true },
        status: 202,
      };
  }
}

// ── Upto: Settle (durable) ───────────────────────────────────────────
app.post("/settle", async (c) => {
  const body = await c.req.json<{
    payload: UptoPayload;
    requirements: PaymentRequirements;
    settlementAmount: string;
  }>();

  if (!body.payload || !body.requirements || !body.settlementAmount) {
    return c.json({ success: false, errorReason: "missing payload, requirements, or settlementAmount" }, 400);
  }

  const nonce = body.payload.permit2Authorization?.nonce;
  if (!nonce) {
    return c.json({ success: false, errorReason: "missing permit2Authorization.nonce" }, 400);
  }

  const f = getFacilitator(c.env);
  const { coordinator, queue } = settlementPorts(c.env);
  const job: RetryJob = {
    scheme: "upto",
    nonce,
    mode: "broadcast",
    payload: body.payload as unknown as Record<string, unknown>,
    requirements: body.requirements as unknown as Record<string, unknown>,
    settlementAmount: body.settlementAmount,
    network: body.requirements.network,
  };

  const outcome = await settleWithIdempotency({
    coordinator,
    queue,
    settle: () => f.settle(body.payload, body.requirements, body.settlementAmount),
    job,
  });

  const { body: out, status } = outcomeToResponse(outcome);
  return c.json(out, status);
});

// ── Exact: Settle (durable) ──────────────────────────────────────────
app.post("/settle-exact", async (c) => {
  const body = await c.req.json<{
    payload: ExactPayload;
    requirements: PaymentRequirements;
  }>();

  if (!body.payload || !body.requirements) {
    return c.json({ success: false, errorReason: "missing payload or requirements" }, 400);
  }

  const nonce = body.payload.permit2Authorization?.nonce;
  if (!nonce) {
    return c.json({ success: false, errorReason: "missing permit2Authorization.nonce" }, 400);
  }

  const f = getFacilitator(c.env);
  const { coordinator, queue } = settlementPorts(c.env);
  const job: RetryJob = {
    scheme: "exact",
    nonce,
    mode: "broadcast",
    payload: body.payload as unknown as Record<string, unknown>,
    requirements: body.requirements as unknown as Record<string, unknown>,
    network: body.requirements.network,
  };

  const outcome = await settleWithIdempotency({
    coordinator,
    queue,
    settle: () => f.settleExact(body.payload, body.requirements),
    job,
  });

  const { body: out, status } = outcomeToResponse(outcome);
  return c.json(out, status);
});

// ── Payment routes (shared: /verify, /verify-exact, and settle fallthroughs) ──
app.route("/", createFacilitatorRoutes(() => facilitator!));

// ── Queue consumer: retry transient settlement failures ──────────────
//
// The Cloudflare Queue owns retry scheduling (max_retries) and exhaustion
// (dead_letter_queue). The consumer re-runs settle/confirm under the same
// idempotency rules. retrySettle() throws on a still-transient/still-pending
// failure so the Queue counts the attempt and eventually dead-letters; it acks
// on success, a definitive failure, or a broadcast-then-pending hand-off.
//
// Each job carries a mode. A "confirm" job (or an awaiting_receipt record) must
// only CONFIRM the known txHash — never re-broadcast. A "broadcast" job may
// broadcast despite an in_flight lease (the queue OWNS the retry).
async function handleQueue(
  batch: { messages: Array<{ body: RetryJob; ack: () => void; retry: () => void }> },
  env: Bindings,
): Promise<void> {
  const f = getFacilitator(env);
  const { coordinator, queue, confirm } = settlementPorts(env);

  for (const msg of batch.messages) {
    const job = msg.body;

    // A structurally-invalid job can never settle. Ack (drop) it instead of
    // burning the Queue's whole retry budget on a permanent error — a malformed
    // payload would otherwise throw, be caught below, and msg.retry() until
    // max_retries dead-letters it.
    const auth = (job?.payload as unknown as { permit2Authorization?: { nonce?: string; permitted?: { amount?: string } } })?.permit2Authorization;
    if (!job || !job.scheme || !job.nonce || !job.payload || !auth?.nonce) {
      console.error("x402 dropping malformed settle retry job:", job);
      msg.ack();
      continue;
    }

    const settle =
      job.scheme === "exact"
        ? () =>
            f.settleExact(
              job.payload as unknown as ExactPayload,
              job.requirements as unknown as PaymentRequirements,
            )
        : () =>
            f.settle(
              job.payload as unknown as UptoPayload,
              job.requirements as unknown as PaymentRequirements,
              job.settlementAmount ?? "0",
            );

    // Confirm uses the network the tx was broadcast on, defaulting to the
    // configured network. settledAmount echoes what the original settle charged
    // (full authorization for exact; the metered amount for upto). Read defensively
    // so a confirm job never throws synchronously here.
    const network = (job.network ?? (env.NETWORK as Network)) as Network;
    const settledAmount =
      job.scheme === "exact"
        ? auth.permitted?.amount ?? "0"
        : job.settlementAmount ?? "0";
    const confirmFn = (txHash: string) => confirm(txHash, network, settledAmount);

    try {
      await retrySettle({ coordinator, queue, settle, confirm: confirmFn, job });
      msg.ack();
    } catch {
      // Still transient / still pending — let the Queue retry / dead-letter.
      msg.retry();
    }
  }
}

export default {
  fetch: app.fetch,
  queue: handleQueue,
};
