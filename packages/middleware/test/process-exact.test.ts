import { describe, it, expect, vi, beforeEach } from "vitest";
import { processExactPayment, type ExactVerifyFn, type ExactSettleFn } from "../src/exact-core.js";
import type { ExactRoutesConfig } from "../src/types.js";
import type { ExactPayload } from "@x402cloud/evm";


// @x402cloud/protocol is NOT mocked: it is zero-dependency and pure, so a
// hand-written stand-in would only reimplement the thing it stands in for.
// Mock @x402cloud/evm
vi.mock("@x402cloud/evm", async () => {
  const actual = await import("@x402cloud/evm");
  return {
    DEFAULT_USDC_ADDRESSES: {
      "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    parseExactPayload: actual.parseExactPayload,
  };
});

const TEST_PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";

function makeRoutes(): ExactRoutesConfig {
  return {
    "POST /v1/chat/completions": {
      network: "eip155:8453",
      price: "$0.01",
      payTo: TEST_PAY_TO,
    },
  };
}

function makePaymentPayload(): { x402Version: number; payload: ExactPayload } {
  return {
    x402Version: 2,
    payload: {
      signature: "0xdeadbeef" as `0x${string}`,
      permit2Authorization: {
        from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        permitted: { token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, amount: "10000" },
        spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`,
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

describe("processExactPayment (framework-agnostic)", () => {
  let verifyFn: ExactVerifyFn;
  let settleFn: ExactSettleFn;

  beforeEach(() => {
    verifyFn = vi.fn(async () => ({ isValid: true, payer: "0xPayer" }));
    settleFn = vi.fn(async () => ({ success: true, transaction: "0xmocktx", network: "eip155:84532", settledAmount: "10000" }));
  });

  it("returns 'pass' for requests not matching any route", async () => {
    const routes = makeRoutes();
    const request = new Request("http://localhost/health", { method: "GET" });

    const result = await processExactPayment("GET", "/health", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("pass");
    expect(verifyFn).not.toHaveBeenCalled();
  });

  it("returns 'payment_required' when no payment header", async () => {
    const routes = makeRoutes();
    const request = new Request("http://localhost/v1/chat/completions", { method: "POST" });

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("payment_required");
    if (result.action === "payment_required") {
      expect(result.response.x402Version).toBe(2);
      expect(result.response.accepts).toBeDefined();
      expect(result.response.accepts[0].scheme).toBe("exact");
    }
  });

  it("returns 'error' with status 400 for malformed payment header", async () => {
    const routes = makeRoutes();
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": "not-valid-base64!!!" },
    });

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("error");
    if (result.action === "error") {
      expect(result.status).toBe(400);
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

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("verified");
    if (result.action === "verified") {
      expect(result.payer).toBe("0xPayer");
      expect(typeof result.settle).toBe("function");
    }
  });

  it("settle callback settles for full price on successful responses", async () => {
    const routes = makeRoutes();
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("verified");
    if (result.action === "verified") {
      const handlerResponse = new Response(JSON.stringify({ result: "ok" }), { status: 200 });
      const settlement = await result.settle(handlerResponse);

      expect(settlement).not.toBeNull();
      expect(settlement!.settledAmount).toBe("10000"); // $0.01 = 10000 micro-USDC
      expect(settlement!.payer).toBe("0xPayer");
      expect(settleFn).toHaveBeenCalledOnce();
    }
  });

  it("settle callback returns null for error responses", async () => {
    const routes = makeRoutes();
    const paymentPayload = makePaymentPayload();
    const encoded = encodePaymentHeader(paymentPayload);

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    });

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("verified");
    if (result.action === "verified") {
      const errorResponse = new Response("error", { status: 500 });
      const settlement = await result.settle(errorResponse);

      expect(settlement).toBeNull();
      expect(settleFn).not.toHaveBeenCalled();
    }
  });

  it("returns 'invalid_payment' with 412 for permit2_allowance_required", async () => {
    const failVerify: ExactVerifyFn = vi.fn(async () => ({
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

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, failVerify, settleFn);

    expect(result.action).toBe("invalid_payment");
    if (result.action === "invalid_payment") {
      expect(result.status).toBe(412);
    }
  });

  it("returns 'error' with 500 when no asset configured for network", async () => {
    const routes: ExactRoutesConfig = {
      "POST /v1/chat/completions": {
        network: "eip155:999999" as any,
        price: "$0.01",
        payTo: TEST_PAY_TO,
      },
    };

    const request = new Request("http://localhost/v1/chat/completions", { method: "POST" });

    const result = await processExactPayment("POST", "/v1/chat/completions", request, routes, verifyFn, settleFn);

    expect(result.action).toBe("error");
    if (result.action === "error") {
      expect(result.status).toBe(500);
    }
  });
});
