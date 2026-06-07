import { describe, it, expect } from "vitest";
import { createMeter } from "../src/meter.js";
import { maxWholesaleCost, wholesaleForDurationMs } from "../src/pricing.js";
import { retailPrice } from "@x402cloud/middleware";

const PAYER = "0x0000000000000000000000000000000000000001";

function makeRequest(): Request {
  return new Request("https://sandbox.test/python", {
    method: "POST",
    body: JSON.stringify({ code: "print(1)" }),
    headers: { "content-type": "application/json" },
  });
}

function makeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createMeter", () => {
  it("applies 20% margin over wholesale duration cost", async () => {
    const meter = createMeter();
    const cost = await meter({
      request: makeRequest(),
      response: makeResponse({ stdout: "", stderr: "", exitCode: 0, durationMs: 4000 }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = retailPrice(wholesaleForDurationMs(4000), "1000000000", 2000);
    expect(cost).toBe(expected);
  });

  it("clamps to authorizedAmount when cost would exceed it", async () => {
    const meter = createMeter();
    const cost = await meter({
      request: makeRequest(),
      response: makeResponse({ durationMs: 30_000 }),
      authorizedAmount: "1", // 1 micro-USDC
      payer: PAYER,
    });
    expect(cost).toBe("1");
  });

  it("falls back to max wholesale (with margin) when durationMs missing", async () => {
    const meter = createMeter();
    const cost = await meter({
      request: makeRequest(),
      response: makeResponse({ stdout: "ok" }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = retailPrice(maxWholesaleCost(), "1000000000", 2000);
    expect(cost).toBe(expected);
  });

  it("falls back to max wholesale when response body is unparseable", async () => {
    const meter = createMeter();
    const broken = new Response("not json", { status: 200 });
    const cost = await meter({
      request: makeRequest(),
      response: broken,
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = retailPrice(maxWholesaleCost(), "1000000000", 2000);
    expect(cost).toBe(expected);
  });
});
