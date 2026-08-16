import { describe, it, expect, vi } from "vitest";
import { createFacilitatorRoutes } from "../src/routes.js";
import type { Facilitator } from "../src/types.js";

function makeMockFacilitator(): Facilitator {
  return {
    address: "0xFacilitator" as `0x${string}`,
    network: "eip155:84532",
    schemes: {},
    verify: vi.fn(async () => ({ isValid: true, payer: "0xPayer" })),
    settle: vi.fn(async () => ({
      success: true,
      transaction: "0xtx",
      network: "eip155:84532",
      settledAmount: "5000",
    })),
    verifyExact: vi.fn(async () => ({ isValid: true, payer: "0xPayer" })),
    settleExact: vi.fn(async () => ({
      success: true,
      transaction: "0xtx",
      network: "eip155:84532",
      settledAmount: "10000",
    })),
  };
}

const mockPayload = { signature: "0xsig", permit2Authorization: {} };
const mockRequirements = {
  scheme: "upto",
  network: "eip155:84532",
  asset: "0xUSDC",
  amount: "10000",
  payTo: "0xRecipient",
  maxTimeoutSeconds: 300,
};

/**
 * What the facilitator actually receives: the route PARSES requirements at the
 * HTTP boundary, so the price arrives canonicalized onto `amount`.
 */
const normalizedRequirements = { ...mockRequirements, amount: "10000" };

async function post(app: ReturnType<typeof createFacilitatorRoutes>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createFacilitatorRoutes", () => {
  describe("POST /verify", () => {
    it("delegates to facilitator.verify and returns result", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/verify", {
        payload: mockPayload,
        requirements: mockRequirements,
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ isValid: true, payer: "0xPayer" });
      expect(fac.verify).toHaveBeenCalledWith(mockPayload, normalizedRequirements);
    });

    it("returns 400 if payload missing", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/verify", { requirements: mockRequirements });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { isValid: boolean; invalidReason: string };
      expect(body.isValid).toBe(false);
      expect(body.invalidReason).toMatch(/missing/);
      expect(fac.verify).not.toHaveBeenCalled();
    });

    it("returns 400 if requirements missing", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/verify", { payload: mockPayload });

      expect(res.status).toBe(400);
      expect(fac.verify).not.toHaveBeenCalled();
    });

    // The old message was "missing payload or requirements", which is a lie
    // when the requirements object is right there and merely has no price.
    it("says what is actually wrong when requirements carry no price", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);
      const { amount: _amount, ...priceless } = mockRequirements;

      const res = await post(app, "/verify", { payload: mockPayload, requirements: priceless });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { invalidReason: string };
      expect(body.invalidReason).toMatch(/no price/);
      expect(fac.verify).not.toHaveBeenCalled();
    });

    it("accepts the legacy `maxAmount` spelling and hands over a canonical `amount`", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);
      const { amount, ...rest } = mockRequirements;

      const res = await post(app, "/verify", {
        payload: mockPayload,
        requirements: { ...rest, maxAmount: amount },
      });

      expect(res.status).toBe(200);
      expect(fac.verify).toHaveBeenCalledWith(mockPayload, normalizedRequirements);
    });

    // SECURITY: an offer showing one price and asking to be paid another is not
    // reconciled in anyone's favour — it is refused.
    it("refuses requirements whose two price spellings disagree", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/verify", {
        payload: mockPayload,
        requirements: { ...mockRequirements, amount: "1000", maxAmount: "1000000000" },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { invalidReason: string };
      expect(body.invalidReason).toMatch(/ambiguous/);
      expect(fac.verify).not.toHaveBeenCalled();
    });
  });

  describe("POST /settle", () => {
    it("delegates to facilitator.settle with settlementAmount", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/settle", {
        payload: mockPayload,
        requirements: mockRequirements,
        settlementAmount: "5000",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(fac.settle).toHaveBeenCalledWith(mockPayload, normalizedRequirements, "5000");
    });

    it("returns 400 if settlementAmount missing", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/settle", {
        payload: mockPayload,
        requirements: mockRequirements,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; errorReason: string };
      expect(body.success).toBe(false);
      expect(body.errorReason).toMatch(/missing/);
      expect(fac.settle).not.toHaveBeenCalled();
    });

    it("returns 400 if payload missing", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/settle", {
        requirements: mockRequirements,
        settlementAmount: "5000",
      });

      expect(res.status).toBe(400);
      expect(fac.settle).not.toHaveBeenCalled();
    });
  });

  describe("POST /verify-exact", () => {
    it("delegates to facilitator.verifyExact", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/verify-exact", {
        payload: mockPayload,
        requirements: { ...mockRequirements, scheme: "exact" },
      });

      expect(res.status).toBe(200);
      expect(fac.verifyExact).toHaveBeenCalled();
    });

    it("returns 400 on missing fields", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/verify-exact", {});
      expect(res.status).toBe(400);
      expect(fac.verifyExact).not.toHaveBeenCalled();
    });
  });

  describe("POST /settle-exact", () => {
    it("delegates to facilitator.settleExact", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/settle-exact", {
        payload: mockPayload,
        requirements: { ...mockRequirements, scheme: "exact" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(fac.settleExact).toHaveBeenCalled();
    });

    it("returns 400 on missing fields", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac);

      const res = await post(app, "/settle-exact", { payload: mockPayload });
      expect(res.status).toBe(400);
      expect(fac.settleExact).not.toHaveBeenCalled();
    });
  });

  describe("lazy getter", () => {
    it("calls getFacilitator on each request (supports lazy init)", async () => {
      const fac = makeMockFacilitator();
      const getter = vi.fn(() => fac);
      const app = createFacilitatorRoutes(getter);

      await post(app, "/verify", { payload: mockPayload, requirements: mockRequirements });
      await post(app, "/verify", { payload: mockPayload, requirements: mockRequirements });

      expect(getter).toHaveBeenCalledTimes(2);
    });

    it("does not invoke getter on malformed body (400 short-circuits before getter)", async () => {
      const fac = makeMockFacilitator();
      const getter = vi.fn(() => fac);
      const app = createFacilitatorRoutes(getter);

      await post(app, "/verify", {});
      expect(getter).not.toHaveBeenCalled();
    });
  });

  describe("auth option (binds middleware to routes)", () => {
    const auth = async (c: { req: { header: (k: string) => string | undefined }; json: (b: unknown, s?: number) => Response }, next: () => Promise<void>) => {
      if (c.req.header("Authorization") !== "Bearer test-token") {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    };

    it("rejects /verify without auth header", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac, { auth: auth as never });

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: mockPayload, requirements: mockRequirements }),
      });
      expect(res.status).toBe(401);
      expect(fac.verify).not.toHaveBeenCalled();
    });

    it("accepts /verify with valid auth header", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac, { auth: auth as never });

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": "Bearer test-token" },
        body: JSON.stringify({ payload: mockPayload, requirements: mockRequirements }),
      });
      expect(res.status).toBe(200);
      expect(fac.verify).toHaveBeenCalled();
    });

    it("auth applies uniformly to /verify, /settle, /verify-exact, /settle-exact", async () => {
      const fac = makeMockFacilitator();
      const app = createFacilitatorRoutes(() => fac, { auth: auth as never });

      for (const path of ["/verify", "/settle", "/verify-exact", "/settle-exact"]) {
        const res = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: mockPayload, requirements: mockRequirements, settlementAmount: "100" }),
        });
        expect(res.status).toBe(401);
      }
      expect(fac.verify).not.toHaveBeenCalled();
      expect(fac.settle).not.toHaveBeenCalled();
      expect(fac.verifyExact).not.toHaveBeenCalled();
      expect(fac.settleExact).not.toHaveBeenCalled();
    });
  });
});
