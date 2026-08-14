import { Hono, type MiddlewareHandler } from "hono";
import type { PaymentRequirements, Scheme } from "@x402cloud/protocol";
import type { UptoPayload, ExactPayload } from "@x402cloud/evm";
import type { Facilitator } from "./types.js";

export type CreateFacilitatorRoutesOptions = {
  /**
   * Middleware applied to every payment route (`/verify`, `/settle`,
   * `/verify-exact`, `/settle-exact`) before the handler runs. Pass a
   * bearer-token check here so auth cannot be accidentally omitted at the
   * mount site. If omitted, the routes are unauthenticated — only suitable
   * for local development or when the caller has its own gateway-level auth.
   */
  auth?: MiddlewareHandler;
};

/**
 * Create shared Hono routes for a facilitator.
 *
 * Returns a Hono app with /verify, /settle, /verify-exact, /settle-exact routes.
 * Pass `options.auth` to bind authentication directly to the routes. Info
 * routes (/, /health, etc.) live at the call site.
 *
 * @param getFacilitator - Lazy getter (supports Workers lazy init and Docker eager init)
 * @param options        - Optional auth middleware
 */
export function createFacilitatorRoutes(
  getFacilitator: () => Facilitator,
  options: CreateFacilitatorRoutesOptions = {},
): Hono {
  const routes = new Hono();

  if (options.auth) {
    routes.use("/verify", options.auth);
    routes.use("/settle", options.auth);
    routes.use("/verify-exact", options.auth);
    routes.use("/settle-exact", options.auth);
  }

  // ── Upto: Verify ────────────────────────────────────────────────────
  routes.post("/verify", async (c) => {
    const body = await c.req.json<{
      payload: UptoPayload;
      requirements: PaymentRequirements;
    }>();

    if (!body.payload || !body.requirements) {
      return c.json({ isValid: false, invalidReason: "missing payload or requirements" }, 400);
    }

    const f = getFacilitator();
    const result = await f.verify(body.payload, body.requirements);
    return c.json(result);
  });

  // ── Upto: Settle ────────────────────────────────────────────────────
  routes.post("/settle", async (c) => {
    const body = await c.req.json<{
      payload: UptoPayload;
      requirements: PaymentRequirements;
      settlementAmount: string;
    }>();

    if (!body.payload || !body.requirements || !body.settlementAmount) {
      return c.json({ success: false, errorReason: "missing payload, requirements, or settlementAmount" }, 400);
    }

    const f = getFacilitator();
    const result = await f.settle(body.payload, body.requirements, body.settlementAmount);
    return c.json(result);
  });

  // ── Fee quote (workspace#45) ────────────────────────────────────────
  // Public and unauthenticated, like /supported — it is a price quote, not a
  // mutation, so it is deliberately NOT in the `options.auth` route list
  // above. Lets a server set its 402 `maxPrice` with fee headroom included
  // (quote time) without needing the facilitator's bearer token.
  routes.get("/fee", async (c) => {
    const schemeParam = c.req.query("scheme");
    const scheme: Scheme = schemeParam === "exact" ? "exact" : "upto";

    const f = getFacilitator();
    if (!f.estimateFee) {
      return c.json({ error: "fee_estimation_unavailable" }, 501);
    }

    const estimate = await f.estimateFee(scheme);
    const body = {
      scheme,
      network: f.network,
      settlementFee: estimate.microUsdc,
      degraded: estimate.degraded,
    };
    // Surface the degraded state on the wire (workspace#45), not just in the
    // body — a caller that only checks status/headers still sees it.
    return c.json(body, 200, estimate.degraded ? { "X-Fee-Degraded": "true" } : {});
  });

  // ── Exact: Verify ───────────────────────────────────────────────────
  routes.post("/verify-exact", async (c) => {
    const body = await c.req.json<{
      payload: ExactPayload;
      requirements: PaymentRequirements;
    }>();

    if (!body.payload || !body.requirements) {
      return c.json({ isValid: false, invalidReason: "missing payload or requirements" }, 400);
    }

    const f = getFacilitator();
    const result = await f.verifyExact(body.payload, body.requirements);
    return c.json(result);
  });

  // ── Exact: Settle ───────────────────────────────────────────────────
  routes.post("/settle-exact", async (c) => {
    const body = await c.req.json<{
      payload: ExactPayload;
      requirements: PaymentRequirements;
    }>();

    if (!body.payload || !body.requirements) {
      return c.json({ success: false, errorReason: "missing payload or requirements" }, 400);
    }

    const f = getFacilitator();
    const result = await f.settleExact(body.payload, body.requirements);
    return c.json(result);
  });

  return routes;
}
