import { Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createFacilitator, createFacilitatorRoutes, type Facilitator } from "@x402cloud/facilitator";
import {
  parseRequirements,
  type Network,
  type PaymentRequirements,
  type PaymentRequirementsInput,
  type SettleResponse,
} from "@x402cloud/protocol";
import type { UptoPayload, ExactPayload } from "@x402cloud/evm";
import { CHAINS } from "@x402cloud/evm";
import type { ServiceMeta, ServiceRoute, ServiceSkill } from "@x402cloud/discovery";
import { mountDiscovery } from "@x402cloud/discovery/hono";
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

const BASE_URL = "https://facilitator.x402cloud.ai";

// --- Discovery data (drives /llms.txt, /robots.txt, /sitemap.xml,
// /.well-known/agent-card.json, /.well-known/api-catalog via mountDiscovery,
// plus the bonus /openapi.json + /agents.json that come for free). ---
//
// These routes aren't x402-priced (no `payment` block) — the facilitator
// gates /verify*/settle* with a bearer token (FACILITATOR_API_TOKEN), not a
// per-call x402 payment, so ServiceRoute.payment is intentionally omitted and
// skills are supplied explicitly rather than derived from `payment`.
//
// The narrative facts that the old hand-written llms.txt carried but that
// have no dedicated ServiceMeta/ServiceRoute field (self-host Docker command,
// integration code sample, source repo link) are folded into `description`
// below so they still surface in llms.txt and openapi.json#info.description
// — nothing is silently dropped. The one exception: the old llms.txt embedded
// the *live* `NETWORK`/`OUR_ADDRESS` values read from `c.env` per request;
// `ServiceMeta` is static (built once, not per-request), so those dynamic
// values are no longer inlined into llms.txt — they remain discoverable
// exactly as before via `GET /supported`, which still reads live env.

const REQUEST_BODY_NOTE =
  "Request/response JSON Schemas for every endpoint are in GET /openapi.json.";

const DISCOVERY_META: ServiceMeta = {
  name: "facilitator.x402cloud.ai",
  description:
    "x402 protocol facilitator — verify and settle USDC micropayments on-chain. " +
    "Verifies Permit2-signed USDC payments and settles them on-chain so x402 " +
    "middleware can handle payment verification without servers needing " +
    "private keys. Supports both exact (fixed-price) and upto (metered) " +
    "payment schemes. " +
    "Self-host: also available as a Docker image — " +
    "`docker run -e FACILITATOR_PRIVATE_KEY=0x... -e RPC_URL=https://mainnet.base.org " +
    "-e NETWORK=eip155:8453 -p 3000:3000 ghcr.io/x402cloud/facilitator`. " +
    "Integration: servers use @x402cloud/middleware with a facilitator URL " +
    "(`remoteExactPaymentMiddleware(routes, \"https://facilitator.x402cloud.ai\")`); " +
    "the middleware calls /verify-exact on each request and /settle-exact after " +
    "successful responses (the /verify + /settle pair for the upto scheme). " +
    `${REQUEST_BODY_NOTE} Source: https://github.com/x402cloud/x402cloud`,
  baseUrl: BASE_URL,
  version: "0.1.0",
  contactUrl: "https://x402cloud.ai",
};

const DISCOVERY_ROUTES: ServiceRoute[] = [
  {
    path: "/supported",
    method: "GET",
    operationId: "getSupported",
    summary: "Supported schemes, networks, and facilitator address. No auth required.",
    tags: ["facilitator"],
    kind: "facilitator",
    responseSchema: {
      type: "object",
      properties: {
        schemes: { type: "array", items: { type: "string" } },
        networks: { type: "array", items: { type: "string" } },
        facilitator: { type: "string" },
      },
    },
  },
  {
    path: "/verify",
    method: "POST",
    operationId: "verifyUpto",
    summary: "Verify an upto (metered) payment payload against requirements. Requires bearer auth.",
    tags: ["facilitator", "upto"],
    kind: "facilitator",
    requestSchema: {
      type: "object",
      required: ["payload", "requirements"],
      properties: {
        payload: { type: "object", description: "Signed Permit2 upto payment payload" },
        requirements: { type: "object", description: "Payment requirements to verify against" },
      },
    },
    responseSchema: {
      type: "object",
      properties: { isValid: { type: "boolean" }, invalidReason: { type: "string" } },
    },
    extraResponses: { "401": { description: "Missing or invalid bearer token" } },
    examples: ['POST /verify with { "payload": { ... }, "requirements": { ... } }'],
  },
  {
    path: "/settle",
    method: "POST",
    operationId: "settleUpto",
    summary: "Settle an upto payment on-chain for the metered amount. Requires bearer auth.",
    tags: ["facilitator", "upto"],
    kind: "facilitator",
    requestSchema: {
      type: "object",
      required: ["payload", "settlementAmount"],
      properties: {
        payload: { type: "object", description: "Signed Permit2 upto payment payload" },
        requirements: { type: "object", description: "Payment requirements the payload was verified against" },
        settlementAmount: { type: "string", description: "Actual metered usage cost, <= the authorized amount" },
      },
    },
    responseSchema: {
      type: "object",
      properties: { success: { type: "boolean" }, txHash: { type: "string" }, errorReason: { type: "string" } },
    },
    extraResponses: { "401": { description: "Missing or invalid bearer token" } },
    examples: ['POST /settle with { "payload": { ... }, "requirements": { ... }, "settlementAmount": "1000000" }'],
  },
  {
    path: "/verify-exact",
    method: "POST",
    operationId: "verifyExact",
    summary: "Verify an exact (fixed-price) payment payload against requirements. Requires bearer auth.",
    tags: ["facilitator", "exact"],
    kind: "facilitator",
    requestSchema: {
      type: "object",
      required: ["payload", "requirements"],
      properties: {
        payload: { type: "object", description: "Signed Permit2 exact payment payload" },
        requirements: { type: "object", description: "Payment requirements to verify against" },
      },
    },
    responseSchema: {
      type: "object",
      properties: { isValid: { type: "boolean" }, invalidReason: { type: "string" } },
    },
    extraResponses: { "401": { description: "Missing or invalid bearer token" } },
    examples: ['POST /verify-exact with { "payload": { ... }, "requirements": { ... } }'],
  },
  {
    path: "/settle-exact",
    method: "POST",
    operationId: "settleExact",
    summary: "Settle an exact payment on-chain for the full authorized amount. Requires bearer auth.",
    tags: ["facilitator", "exact"],
    kind: "facilitator",
    requestSchema: {
      type: "object",
      required: ["payload", "requirements"],
      properties: {
        payload: { type: "object", description: "Signed Permit2 exact payment payload" },
        requirements: { type: "object", description: "Payment requirements the payload was verified against" },
      },
    },
    responseSchema: {
      type: "object",
      properties: { success: { type: "boolean" }, txHash: { type: "string" }, errorReason: { type: "string" } },
    },
    extraResponses: { "401": { description: "Missing or invalid bearer token" } },
    examples: ['POST /settle-exact with { "payload": { ... }, "requirements": { ... } }'],
  },
];

const DISCOVERY_SKILLS: ServiceSkill[] = [
  { id: "verify", name: "Verify Upto Payment", description: "Verify an upto payment payload", tags: ["facilitator", "upto", "x402"] },
  { id: "settle", name: "Settle Upto Payment", description: "Settle an upto payment on-chain via Permit2", tags: ["facilitator", "upto", "x402"] },
  { id: "verify-exact", name: "Verify Exact Payment", description: "Verify an exact (fixed-price) payment payload", tags: ["facilitator", "exact", "x402"] },
  { id: "settle-exact", name: "Settle Exact Payment", description: "Settle an exact payment on-chain via Permit2", tags: ["facilitator", "exact", "x402"] },
];

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

// ── Health ───────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Discovery surface (llms.txt, robots.txt, sitemap.xml, agent-card.json,
// api-catalog — plus openapi.json + agents.json for free) ──────────────
mountDiscovery(app, DISCOVERY_META, DISCOVERY_ROUTES, { skills: DISCOVERY_SKILLS });

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

// protectPaymentRoute (fail-closed token check + lazy facilitator init) guards
// the standalone durable settle handlers below, which shadow the shared
// /settle + /settle-exact routes. /verify + /verify-exact are protected via the
// { auth } option on createFacilitatorRoutes at the mount site.
app.use("/settle", protectPaymentRoute);
app.use("/settle-exact", protectPaymentRoute);

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
    requirements: PaymentRequirementsInput;
    settlementAmount: string;
  }>();

  if (!body.payload || !body.settlementAmount) {
    return c.json({ success: false, errorReason: "missing payload or settlementAmount" }, 400);
  }

  // Parse here too. This durable route SHADOWS the shared `/settle` in
  // `@x402cloud/facilitator`, so anything the shared route guarantees has to be
  // re-established — notably a canonical `requirements.amount`, which is the
  // quote ceiling `settleUpto` enforces. It is also what gets serialized into
  // the RetryJob, so a retry days later settles against the same parsed number.
  const parsed = parseRequirements(body.requirements);
  if (!parsed.ok) {
    return c.json({ success: false, errorReason: parsed.error }, 400);
  }
  const requirements = parsed.value;

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
    requirements: requirements as unknown as Record<string, unknown>,
    settlementAmount: body.settlementAmount,
    network: requirements.network,
  };

  const outcome = await settleWithIdempotency({
    coordinator,
    queue,
    settle: () => f.settle(body.payload, requirements, body.settlementAmount),
    job,
  });

  const { body: out, status } = outcomeToResponse(outcome);
  return c.json(out, status);
});

// ── Exact: Settle (durable) ──────────────────────────────────────────
app.post("/settle-exact", async (c) => {
  const body = await c.req.json<{
    payload: ExactPayload;
    requirements: PaymentRequirementsInput;
  }>();

  if (!body.payload) {
    return c.json({ success: false, errorReason: "missing payload" }, 400);
  }

  // Same reason as `/settle` above: this route shadows the shared one, so it
  // owns the parse that makes `requirements.amount` canonical.
  const parsed = parseRequirements(body.requirements);
  if (!parsed.ok) {
    return c.json({ success: false, errorReason: parsed.error }, 400);
  }
  const requirements = parsed.value;

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
    requirements: requirements as unknown as Record<string, unknown>,
    network: requirements.network,
  };

  const outcome = await settleWithIdempotency({
    coordinator,
    queue,
    settle: () => f.settleExact(body.payload, requirements),
    job,
  });

  const { body: out, status } = outcomeToResponse(outcome);
  return c.json(out, status);
});

// ── Payment routes (shared: /verify, /verify-exact, + settle fallthroughs) ──
// Auth applied via the { auth } option (PR #3's first-class auth on the routes).
app.route(
  "/",
  createFacilitatorRoutes(() => facilitator!, {
    auth: protectPaymentRoute as MiddlewareHandler,
  }),
);

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
