import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { buildUptoMiddleware, clampToQuote, type VerifyFn, type SettleFn } from "../src/core.js";
import type { UptoRoutesConfig, UptoRouteConfig } from "../src/types.js";
import type { MeterFunction } from "@x402cloud/protocol";

// @x402cloud/protocol is NOT mocked: it is zero-dependency and pure.
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

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";
const PAYER = "0x00000000000000000000000000000000000Da1d0";
const FACILITATOR = "0x9999999999999999999999999999999999999999" as const;

/** A payer who authorized a WALLET BUDGET of $1.00, not a per-call price. */
const WALLET_BUDGET = "1000000";

function routesMetering(meter: MeterFunction): UptoRoutesConfig {
  const route: UptoRouteConfig = {
    network: "eip155:8453",
    maxPrice: "$0.0056", // the quote: 5600 micro-USDC
    payTo: PAY_TO,
    meter,
  };
  return { "POST /v1/chat/completions": route };
}

function paymentHeader(): string {
  return btoa(
    JSON.stringify({
      x402Version: 2,
      payload: {
        signature: "0xdeadbeef",
        permit2Authorization: {
          from: PAYER,
          permitted: {
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount: WALLET_BUDGET,
          },
          spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          nonce: "1",
          deadline: "9999999999",
          witness: { to: PAY_TO, facilitator: FACILITATOR, validAfter: "0" },
        },
      },
    }),
  );
}

async function payFor(meter: MeterFunction, settleFn: SettleFn) {
  const verifyFn: VerifyFn = vi.fn(async () => ({ isValid: true, payer: PAYER }));
  const app = new Hono();
  app.use("*", buildUptoMiddleware(routesMetering(meter), verifyFn, settleFn, FACILITATOR));
  app.post("/v1/chat/completions", (c) => c.json({ result: "ok" }));

  return app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "PAYMENT-SIGNATURE": paymentHeader() },
  });
}

describe("clampToQuote", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("passes a metered amount at or below the quote through unchanged", () => {
    expect(clampToQuote("4200", "5600")).toBe("4200");
    expect(clampToQuote("5600", "5600")).toBe("5600");
    expect(clampToQuote("0", "5600")).toBe("0");
  });

  it("clamps an overrun to the quote and says so loudly", () => {
    expect(clampToQuote("89000", "5600")).toBe("5600");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("charges nothing for a meter that returns garbage", () => {
    expect(clampToQuote("not-a-number", "5600")).toBe("0");
    expect(clampToQuote("-1", "5600")).toBe("0");
  });
});

describe("the advertised price is a settlement ceiling", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("settles the metered amount when it is below the quote", async () => {
    const settleFn: SettleFn = vi.fn(async () => ({
      success: true,
      transaction: "0xtx",
      network: "eip155:8453",
      settledAmount: "4200",
    }));

    const res = await payFor(() => "4200", settleFn);

    expect(res.status).toBe(200);
    expect(settleFn).toHaveBeenCalledWith(expect.anything(), expect.anything(), "4200");
    expect(res.headers.get("X-Payment-Settled")).toBe("4200");
  });

  // SECURITY (the whole point): the payer authorized a $1.00 wallet budget and
  // was quoted $0.0056. A meter returning $0.089 must not be able to reach past
  // the quote just because the budget covers it.
  it("never settles above the quoted price, however much the payer authorized", async () => {
    const settleFn: SettleFn = vi.fn(async () => ({
      success: true,
      transaction: "0xtx",
      network: "eip155:8453",
      settledAmount: "5600",
    }));

    const res = await payFor(() => "89000", settleFn);

    expect(res.status).toBe(200);
    // Charged the quote, not the meter, and nowhere near the $1.00 budget.
    expect(settleFn).toHaveBeenCalledWith(expect.anything(), expect.anything(), "5600");
    expect(res.headers.get("X-Payment-Settled")).toBe("5600");
    expect(errorSpy).toHaveBeenCalled();
  });
});
