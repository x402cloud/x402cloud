import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { buildUptoMiddleware, type VerifyFn, type SettleFn } from "../src/core.js";
import type { UptoRoutesConfig } from "../src/types.js";
import type { UptoPayload } from "@x402cloud/evm";

// Mock @x402cloud/protocol
vi.mock("@x402cloud/protocol", () => ({
  extractPaymentHeader: vi.fn((req: Request) =>
    req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT") ?? null,
  ),
  decodePaymentHeader: vi.fn((header: string) => {
    try {
      return JSON.parse(atob(header));
    } catch {
      throw new Error("Invalid payment header");
    }
  }),
  parseUsdcAmount: vi.fn((price: string) => {
    const cleaned = price.replace(/[$,\s]/g, "");
    const [intPart, fracPart = ""] = cleaned.split(".");
    const padded = fracPart.padEnd(6, "0").slice(0, 6);
    return (intPart + padded).replace(/^0+/, "") || "0";
  }),
  encodeRequirementsHeader: vi.fn((required: unknown) => btoa(JSON.stringify(required))),
}));

// Mock @x402cloud/evm
vi.mock("@x402cloud/evm", async () => {
  const actual = await import("@x402cloud/evm");
  return {
    DEFAULT_USDC_ADDRESSES: {
      "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    parseUptoPayload: actual.parseUptoPayload,
  };
});

const TEST_PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";

function makeRoutes(): UptoRoutesConfig {
  return {
    "POST /v1/chat/completions": {
      network: "eip155:8453",
      maxPrice: "$0.01",
      payTo: TEST_PAY_TO,
      meter: vi.fn(async () => "5000"),
    },
  };
}

function makePaymentPayload(): { x402Version: number; payload: UptoPayload } {
  return {
    x402Version: 2,
    payload: {
      signature: "0xdeadbeef" as `0x${string}`,
      permit2Authorization: {
        from: "0xPayer" as `0x${string}`,
        permitted: { token: "0xUSDC" as `0x${string}`, amount: "10000" },
        spender: "0xSpender" as `0x${string}`,
        nonce: "1",
        deadline: "9999999999",
        witness: {
          to: TEST_PAY_TO as `0x${string}`,
          validAfter: "0",
          extra: "0x" as `0x${string}`,
        },
      },
    },
  };
}

function encodePaymentHeader(payload: unknown): string {
  return btoa(JSON.stringify(payload));
}

describe("buildUptoMiddleware", () => {
  let verifyFn: VerifyFn;
  let settleFn: SettleFn;

  beforeEach(() => {
    verifyFn = vi.fn(async () => ({ isValid: true, payer: "0xPayer" }));
    settleFn = vi.fn(async () => {});
  });

  it("passes through requests not matching any route", async () => {
    const routes = makeRoutes();
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn));
    app.get("/health", (c) => c.json({ status: "ok" }));

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(verifyFn).not.toHaveBeenCalled();
  });

  it("returns 402 with PAYMENT-REQUIRED header when no payment header", async () => {
    const routes = makeRoutes();
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

    const res = await app.request("/v1/chat/completions", { method: "POST" });
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.accepts).toBeDefined();
    expect(body.x402Version).toBe(2);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeDefined();
  });

  it("returns 400 for malformed payment header", async () => {
    const routes = makeRoutes();
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": "not-valid-base64!!!" },
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("Invalid payment header");
  });

  it("calls verify, then next, then meter, then settle for valid payment", async () => {
    const routes = makeRoutes();
    const meterFn = routes["POST /v1/chat/completions"].meter;
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ result: "inference done" }));

    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    expect(res.status).toBe(200);
    expect(verifyFn).toHaveBeenCalledOnce();
    expect(meterFn).toHaveBeenCalledOnce();
    expect(settleFn).toHaveBeenCalledOnce();

    // Verify settlement was called with metered amount
    expect(settleFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "5000",
    );

    // Check response headers
    expect(res.headers.get("X-Payment-Settled")).toBe("5000");
    expect(res.headers.get("X-Payment-Payer")).toBe("0xPayer");
  });

  it("returns 402 when verification fails", async () => {
    const failVerify: VerifyFn = vi.fn(async () => ({
      isValid: false,
      invalidReason: "insufficient_balance",
    }));

    const routes = makeRoutes();
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, failVerify, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Payment verification failed");
    expect(body.reason).toBe("insufficient_balance");
    expect(settleFn).not.toHaveBeenCalled();
  });

  it("returns 412 when permit2_allowance_required", async () => {
    const failVerify: VerifyFn = vi.fn(async () => ({
      isValid: false,
      invalidReason: "permit2_allowance_required",
    }));

    const routes = makeRoutes();
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, failVerify, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    expect(res.status).toBe(412);
  });

  it("skips settlement if handler returns error (status >= 400)", async () => {
    const routes = makeRoutes();
    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ error: "bad request" }, 400));

    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    expect(res.status).toBe(400);
    expect(verifyFn).toHaveBeenCalledOnce();
    expect(settleFn).not.toHaveBeenCalled();
  });

  it("returns 500 when no asset configured for network", async () => {
    const routes: UptoRoutesConfig = {
      "POST /v1/chat/completions": {
        network: "eip155:999999" as any,
        maxPrice: "$0.01",
        payTo: TEST_PAY_TO,
        meter: vi.fn(async () => "5000"),
      },
    };

    const app = new Hono();
    app.use("*", buildUptoMiddleware(routes, verifyFn, settleFn));
    app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

    const res = await app.request("/v1/chat/completions", { method: "POST" });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain("no asset for network");
  });
});
