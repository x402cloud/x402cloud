import { Hono, type MiddlewareHandler } from "hono";
import { parseRequirements, type PaymentRequirementsInput } from "@x402cloud/protocol";
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
      requirements: PaymentRequirementsInput;
    }>();

    if (!body.payload) {
      return c.json({ isValid: false, invalidReason: "missing payload" }, 400);
    }
    const parsed = parseRequirements(body.requirements);
    if (!parsed.ok) {
      return c.json({ isValid: false, invalidReason: parsed.error }, 400);
    }

    const f = getFacilitator();
    const result = await f.verify(body.payload, parsed.value);
    return c.json(result);
  });

  // ── Upto: Settle ────────────────────────────────────────────────────
  routes.post("/settle", async (c) => {
    const body = await c.req.json<{
      payload: UptoPayload;
      requirements: PaymentRequirementsInput;
      settlementAmount: string;
    }>();

    if (!body.payload || !body.settlementAmount) {
      return c.json({ success: false, errorReason: "missing payload or settlementAmount" }, 400);
    }
    const parsed = parseRequirements(body.requirements);
    if (!parsed.ok) {
      return c.json({ success: false, errorReason: parsed.error }, 400);
    }

    const f = getFacilitator();
    const result = await f.settle(body.payload, parsed.value, body.settlementAmount);
    return c.json(result);
  });

  // ── Exact: Verify ───────────────────────────────────────────────────
  routes.post("/verify-exact", async (c) => {
    const body = await c.req.json<{
      payload: ExactPayload;
      requirements: PaymentRequirementsInput;
    }>();

    if (!body.payload) {
      return c.json({ isValid: false, invalidReason: "missing payload" }, 400);
    }
    const parsed = parseRequirements(body.requirements);
    if (!parsed.ok) {
      return c.json({ isValid: false, invalidReason: parsed.error }, 400);
    }

    const f = getFacilitator();
    const result = await f.verifyExact(body.payload, parsed.value);
    return c.json(result);
  });

  // ── Exact: Settle ───────────────────────────────────────────────────
  routes.post("/settle-exact", async (c) => {
    const body = await c.req.json<{
      payload: ExactPayload;
      requirements: PaymentRequirementsInput;
    }>();

    if (!body.payload) {
      return c.json({ success: false, errorReason: "missing payload" }, 400);
    }
    const parsed = parseRequirements(body.requirements);
    if (!parsed.ok) {
      return c.json({ success: false, errorReason: parsed.error }, 400);
    }

    const f = getFacilitator();
    const result = await f.settleExact(body.payload, parsed.value);
    return c.json(result);
  });

  return routes;
}
