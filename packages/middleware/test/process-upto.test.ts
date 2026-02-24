import { describe, it, expect, vi, beforeEach } from "vitest";
import { processUptoPayment, type VerifyFn, type SettleFn, type PaymentFlowResult } from "../src/core.js";
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

describe("processUptoPayment (framework-agnostic)", () => {
  let verifyFn: VerifyFn;
  let settleFn: SettleFn;

  beforeEach(() => {
    verifyFn = vi.fn(async () => ({ isValid: true, payer: "0xPayer" }));
    settleFn = vi.fn(async () => {});
  });

  it("returns 'pass' for requests not matching any route", async () => {
    const routes = makeRoutes();
    const request = new Request("http://localhost/health", { method: "GET" });

    const result = await processUptoPayment("GET", "/health", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("pass");
    expect(verifyFn).not.toHaveBeenCalled();
  });

  it("returns 'payment_required' when no payment header", async () => {
    const routes = makeRoutes();
    const request = new Request("http://localhost/v1/chat/completions", { method: "POST" });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("payment_required");
    if (result.action === "payment_required") {
      expect(result.response.x402Version).toBe(2);
      expect(result.response.accepts).toBeDefined();
      expect(result.encoded).toBeDefined();
    }
  });

  it("returns 'error' with status 400 for malformed payment header", async () => {
    const routes = makeRoutes();
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": "not-valid-base64!!!" },
    });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("error");
    if (result.action === "error") {
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: "Invalid payment header" });
    }
  });

  it("returns 'verified' with settle callback for valid payment", async () => {
    const routes = makeRoutes();
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("verified");
    if (result.action === "verified") {
      expect(result.payer).toBe("0xPayer");
      expect(typeof result.settle).toBe("function");
    }
    expect(verifyFn).toHaveBeenCalledOnce();
  });

  it("settle callback meters and settles for successful responses", async () => {
    const routes = makeRoutes();
    const meterFn = routes["POST /v1/chat/completions"].meter;
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("verified");
    if (result.action === "verified") {
      // Simulate a successful handler response
      const handlerResponse = new Response(JSON.stringify({ result: "ok" }), { status: 200 });
      const settlement = await result.settle(handlerResponse);

      expect(settlement).not.toBeNull();
      expect(settlement!.settledAmount).toBe("5000");
      expect(settlement!.payer).toBe("0xPayer");
      expect(meterFn).toHaveBeenCalledOnce();
      expect(settleFn).toHaveBeenCalledWith(expect.anything(), expect.anything(), "5000");
    }
  });

  it("settle callback returns null for error responses (status >= 400)", async () => {
    const routes = makeRoutes();
    const meterFn = routes["POST /v1/chat/completions"].meter;
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("verified");
    if (result.action === "verified") {
      const errorResponse = new Response(JSON.stringify({ error: "bad" }), { status: 500 });
      const settlement = await result.settle(errorResponse);

      expect(settlement).toBeNull();
      expect(meterFn).not.toHaveBeenCalled();
      expect(settleFn).not.toHaveBeenCalled();
    }
  });

  it("returns 'invalid_payment' with 402 when verification fails", async () => {
    const failVerify: VerifyFn = vi.fn(async () => ({
      isValid: false,
      invalidReason: "insufficient_balance",
    }));

    const routes = makeRoutes();
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, failVerify, settleFn);

    expect(result.action).toBe("invalid_payment");
    if (result.action === "invalid_payment") {
      expect(result.status).toBe(402);
      expect((result.body as any).error).toBe("Payment verification failed");
      expect((result.body as any).reason).toBe("insufficient_balance");
    }
  });

  it("returns 'invalid_payment' with 412 for permit2_allowance_required", async () => {
    const failVerify: VerifyFn = vi.fn(async () => ({
      isValid: false,
      invalidReason: "permit2_allowance_required",
    }));

    const routes = makeRoutes();
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, failVerify, settleFn);

    expect(result.action).toBe("invalid_payment");
    if (result.action === "invalid_payment") {
      expect(result.status).toBe(412);
    }
  });

  it("returns 'error' with 500 when no asset configured for network", async () => {
    const routes: UptoRoutesConfig = {
      "POST /v1/chat/completions": {
        network: "eip155:999999" as any,
        maxPrice: "$0.01",
        payTo: TEST_PAY_TO,
        meter: vi.fn(async () => "5000"),
      },
    };

    const request = new Request("http://localhost/v1/chat/completions", { method: "POST" });

    const result = await processUptoPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("error");
    if (result.action === "error") {
      expect(result.status).toBe(500);
      expect((result.body as any).error).toContain("no asset for network");
    }
  });
});
