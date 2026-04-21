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
});
