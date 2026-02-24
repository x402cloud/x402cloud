import { Hono } from "hono";
import type { PaymentRequirements } from "@x402cloud/protocol";
import type { UptoPayload, ExactPayload } from "@x402cloud/evm";
import type { Facilitator } from "./types.js";

/**
 * Create shared Hono routes for a facilitator.
 *
 * Returns a Hono app with /verify, /settle, /verify-exact, /settle-exact routes.
 * The caller is responsible for mounting auth middleware and info routes — this
 * only creates the payment-related endpoints.
 *
 * @param getFacilitator - Lazy getter (supports Workers lazy init and Docker eager init)
 */
export function createFacilitatorRoutes(getFacilitator: () => Facilitator): Hono {
  const routes = new Hono();

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
