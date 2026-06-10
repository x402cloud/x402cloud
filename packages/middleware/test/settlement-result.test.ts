import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { buildUptoMiddleware, type VerifyFn, type SettleFn } from "../src/core.js";
import { remoteUptoPaymentMiddleware } from "../src/remote.js";
import type { MiddlewareOptions, SettlementIntent, SettlementOutcome } from "../src/generic-core.js";
import type { UptoRoutesConfig } from "../src/types.js";
import type { UptoPayload } from "@x402cloud/evm";

// Same module mocks as core.test.ts — keep the unit isolated from protocol/evm internals.
vi.mock("@x402cloud/protocol", () => ({
  extractPaymentHeader: vi.fn((req: Request) =>
    req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT") ?? null,
  ),
  decodePaymentHeader: vi.fn((header: string) => JSON.parse(atob(header))),
  parseUsdcAmount: vi.fn((price: string) => {
    const cleaned = price.replace(/[$,\s]/g, "");
    const [intPart, fracPart = ""] = cleaned.split(".");
    const padded = fracPart.padEnd(6, "0").slice(0, 6);
    return (intPart + padded).replace(/^0+/, "") || "0";
  }),
  encodeRequirementsHeader: vi.fn((required: unknown) => btoa(JSON.stringify(required))),
}));

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
const FACILITATOR = "0x9999999999999999999999999999999999999999" as const;

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

function makeHeader(): string {
  const payload: { x402Version: number; payload: UptoPayload } = {
    x402Version: 2,
    payload: {
      signature: "0xdeadbeef" as `0x${string}`,
      permit2Authorization: {
        from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        permitted: { token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`, amount: "10000" },
        spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`,
        nonce: "1",
        deadline: "9999999999",
        witness: { to: TEST_PAY_TO as `0x${string}`, facilitator: FACILITATOR as `0x${string}`, validAfter: "0" },
      },
    },
  };
  return btoa(JSON.stringify(payload));
}

/** Collects waitUntil promises + intent/result records so a test can await settlement. */
function makeRecorder() {
  const tasks: Promise<unknown>[] = [];
  const intents: SettlementIntent[] = [];
  const results: SettlementOutcome[] = [];
  const options: MiddlewareOptions = {
    waitUntil: (p) => { tasks.push(p); },
    onSettlementIntent: async (i) => { intents.push(i); },
    onSettlementResult: async (o) => { results.push(o); },
  };
  return { tasks, intents, results, options, settle: () => Promise.all(tasks) };
}

const verifyOk: VerifyFn = vi.fn(async () => ({ isValid: true, payer: "0xPayer" }));

describe("settlement outcome recording (durability)", () => {
  it("records a success outcome whose intentId matches the recorded intent", async () => {
    const rec = makeRecorder();
    const settleFn: SettleFn = vi.fn(async () => ({
      success: true, transaction: "0xtx", network: "eip155:8453", settledAmount: "5000",
    }));
    const app = new Hono();
    app.use("*", buildUptoMiddleware(makeRoutes(), verifyOk, settleFn, FACILITATOR, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(res.status).toBe(200);
    expect(rec.intents).toHaveLength(1);
    expect(rec.results).toHaveLength(1);
    expect(rec.results[0].result.success).toBe(true);
    expect(rec.results[0].settlementAmount).toBe("5000");
    // The outcome closes exactly the intent that was opened.
    expect(rec.results[0].intentId).toBe(rec.intents[0].id);
  });

  it("records a failure outcome when settle returns {success:false} (was silently dropped)", async () => {
    const rec = makeRecorder();
    const settleFn: SettleFn = vi.fn(async () => ({
      success: false, errorReason: "settlement_failed: nonce already used",
    }));
    const app = new Hono();
    app.use("*", buildUptoMiddleware(makeRoutes(), verifyOk, settleFn, FACILITATOR, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(rec.results).toHaveLength(1);
    expect(rec.results[0].result.success).toBe(false);
    if (!rec.results[0].result.success) {
      expect(rec.results[0].result.errorReason).toContain("nonce already used");
    }
    expect(rec.results[0].intentId).toBe(rec.intents[0].id);
  });

  it("maps a thrown settle to a failure outcome instead of an unhandled rejection", async () => {
    const rec = makeRecorder();
    const settleFn: SettleFn = vi.fn(async () => { throw new Error("RPC down"); });
    const app = new Hono();
    app.use("*", buildUptoMiddleware(makeRoutes(), verifyOk, settleFn, FACILITATOR, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(rec.results).toHaveLength(1);
    expect(rec.results[0].result.success).toBe(false);
    if (!rec.results[0].result.success) {
      expect(rec.results[0].result.errorReason).toMatch(/^settle_threw: .*RPC down/);
    }
  });

  it("does not open an intent or settle when the handler errors (status >= 400)", async () => {
    const rec = makeRecorder();
    const settleFn: SettleFn = vi.fn(async () => ({
      success: true, transaction: "0xtx", network: "eip155:8453", settledAmount: "5000",
    }));
    const app = new Hono();
    app.use("*", buildUptoMiddleware(makeRoutes(), verifyOk, settleFn, FACILITATOR, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ error: "bad" }, 400));

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(settleFn).not.toHaveBeenCalled();
    expect(rec.intents).toHaveLength(0);
    expect(rec.results).toHaveLength(0);
  });
});

describe("remote settle maps facilitator responses to a definite outcome", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  function stubFacilitator(settleBody: object, settleStatus = 200) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/verify")) {
        return new Response(JSON.stringify({ isValid: true, payer: "0xPayer" }), { status: 200 });
      }
      if (url.endsWith("/settle")) {
        return new Response(JSON.stringify(settleBody), { status: settleStatus });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  }

  it("surfaces an on-chain {success:false} returned with HTTP 200 (the original bug)", async () => {
    const rec = makeRecorder();
    stubFacilitator({ success: false, errorReason: "settlement_failed: reverted" });
    const app = new Hono();
    app.use("*", remoteUptoPaymentMiddleware(makeRoutes(), "https://facilitator.test", FACILITATOR, undefined, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(rec.results).toHaveLength(1);
    expect(rec.results[0].result.success).toBe(false);
  });

  it("maps a non-2xx facilitator response to a failure outcome", async () => {
    const rec = makeRecorder();
    stubFacilitator({ error: "boom" }, 500);
    const app = new Hono();
    app.use("*", remoteUptoPaymentMiddleware(makeRoutes(), "https://facilitator.test", FACILITATOR, { maxRetries: 0 }, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(rec.results).toHaveLength(1);
    expect(rec.results[0].result.success).toBe(false);
    if (!rec.results[0].result.success) {
      expect(rec.results[0].result.errorReason).toBe("facilitator_http_500");
    }
  });

  it("passes through a successful settlement", async () => {
    const rec = makeRecorder();
    stubFacilitator({ success: true, transaction: "0xabc", network: "eip155:8453", settledAmount: "5000" });
    const app = new Hono();
    app.use("*", remoteUptoPaymentMiddleware(makeRoutes(), "https://facilitator.test", FACILITATOR, undefined, rec.options));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": makeHeader() },
    });
    await rec.settle();

    expect(rec.results).toHaveLength(1);
    expect(rec.results[0].result.success).toBe(true);
  });
});
