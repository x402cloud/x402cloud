import { Hono, type MiddlewareHandler } from "hono";
import { normalizeRequirements, type PaymentRequirements } from "@x402cloud/protocol";
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
/**
 * True when `requirements` carries a price under either spelling. Checked at
 * the HTTP boundary so a malformed body gets a 400 with a reason, rather than
 * letting `normalizeRequirements` throw into a bare 500.
 */
function hasPrice(requirements?: PaymentRequirements): boolean {
  return Boolean(requirements && (requirements.maxAmount ?? requirements.amount));
}

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

    if (!body.payload || !hasPrice(body.requirements)) {
      return c.json({ isValid: false, invalidReason: "missing payload or requirements" }, 400);
    }

    const f = getFacilitator();
    const result = await f.verify(body.payload, normalizeRequirements(body.requirements));
    return c.json(result);
  });

  // ── Upto: Settle ────────────────────────────────────────────────────
  routes.post("/settle", async (c) => {
    const body = await c.req.json<{
      payload: UptoPayload;
      requirements: PaymentRequirements;
      settlementAmount: string;
    }>();

    if (!body.payload || !hasPrice(body.requirements) || !body.settlementAmount) {
      return c.json({ success: false, errorReason: "missing payload, requirements, or settlementAmount" }, 400);
    }

    const f = getFacilitator();
    const result = await f.settle(
      body.payload,
      normalizeRequirements(body.requirements),
      body.settlementAmount,
    );
    return c.json(result);
  });

  // ── Exact: Verify ───────────────────────────────────────────────────
  routes.post("/verify-exact", async (c) => {
    const body = await c.req.json<{
      payload: ExactPayload;
      requirements: PaymentRequirements;
    }>();

    if (!body.payload || !hasPrice(body.requirements)) {
      return c.json({ isValid: false, invalidReason: "missing payload or requirements" }, 400);
    }

    const f = getFacilitator();
    const result = await f.verifyExact(body.payload, normalizeRequirements(body.requirements));
    return c.json(result);
  });

  // ── Exact: Settle ───────────────────────────────────────────────────
  routes.post("/settle-exact", async (c) => {
    const body = await c.req.json<{
      payload: ExactPayload;
      requirements: PaymentRequirements;
    }>();

    if (!body.payload || !hasPrice(body.requirements)) {
      return c.json({ success: false, errorReason: "missing payload or requirements" }, 400);
    }

    const f = getFacilitator();
    const result = await f.settleExact(body.payload, normalizeRequirements(body.requirements));
    return c.json(result);
  });

  return routes;
}
