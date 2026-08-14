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
  maxAmount: "10000",
  payTo: "0xRecipient",
  maxTimeoutSeconds: 300,
};

async function post(app: ReturnType<typeof createFacilitatorRoutes>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createFacilitatorRoutes", () => {
  describe("GET /fee (workspace#45)", () => {
    it("returns the facilitator's fee estimate for the default (upto) scheme", async () => {
      const fac = makeMockFacilitator();
      fac.estimateFee = vi.fn(async () => ({ microUsdc: "1234", degraded: false }));
      const app = createFacilitatorRoutes(() => fac);

      const res = await app.request("/fee");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        scheme: "upto",
        network: "eip155:84532",
        settlementFee: "1234",
        degraded: false,
      });
      expect(res.headers.get("X-Fee-Degraded")).toBeNull();
      expect(fac.estimateFee).toHaveBeenCalledWith("upto");
    });

    it("honours ?scheme=exact", async () => {
      const fac = makeMockFacilitator();
      fac.estimateFee = vi.fn(async () => ({ microUsdc: "999", degraded: false }));
      const app = createFacilitatorRoutes(() => fac);

      const res = await app.request("/fee?scheme=exact");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { scheme: string };
      expect(body.scheme).toBe("exact");
      expect(fac.estimateFee).toHaveBeenCalledWith("exact");
    });

    it("treats any unrecognised ?scheme as upto (fails closed to the metered scheme, never throws)", async () => {
      const fac = makeMockFacilitator();
      fac.estimateFee = vi.fn(async () => ({ microUsdc: "1", degraded: false }));
      const app = createFacilitatorRoutes(() => fac);

      const res = await app.request("/fee?scheme=bogus");
      expect(res.status).toBe(200);
      expect(fac.estimateFee).toHaveBeenCalledWith("upto");
    });

    it("surfaces the degraded state via the response body AND an X-Fee-Degraded header", async () => {
      const fac = makeMockFacilitator();
      fac.estimateFee = vi.fn(async () => ({ microUsdc: "999999", degraded: true }));
      const app = createFacilitatorRoutes(() => fac);

      const res = await app.request("/fee");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Fee-Degraded")).toBe("true");
      const body = (await res.json()) as { degraded: boolean };
      expect(body.degraded).toBe(true);
    });

    it("returns 501 when the facilitator does not implement estimateFee", async () => {
      const fac = makeMockFacilitator(); // no estimateFee — a hand-built Facilitator may omit it
      const app = createFacilitatorRoutes(() => fac);

      const res = await app.request("/fee");
      expect(res.status).toBe(501);
    });

    it("is not gated by the auth option (a fee quote is read-only, like /supported)", async () => {
      const fac = makeMockFacilitator();
      fac.estimateFee = vi.fn(async () => ({ microUsdc: "1", degraded: false }));
      const auth = async (c: { json: (b: unknown, s?: number) => Response }) => c.json({ error: "unauthorized" }, 401);
      const app = createFacilitatorRoutes(() => fac, { auth: auth as never });

      const res = await app.request("/fee");
      expect(res.status).toBe(200);
    });
  });

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
      expect(fac.verify).toHaveBeenCalledWith(mockPayload, mockRequirements);
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
      expect(fac.settle).toHaveBeenCalledWith(mockPayload, mockRequirements, "5000");
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
