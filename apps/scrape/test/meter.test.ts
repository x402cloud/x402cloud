import { describe, it, expect } from "vitest";
import { createMeter } from "../src/meter.js";
import { maxWholesaleCost, wholesaleForDurationMs } from "../src/pricing.js";
import { retailPrice } from "@x402cloud/middleware";

const PAYER = "0x0000000000000000000000000000000000000001";

function makeRequest(path = "/page"): Request {
  return new Request(`https://scrape.test${path}`, {
    method: "POST",
    body: JSON.stringify({ url: "https://example.com" }),
    headers: { "content-type": "application/json" },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createMeter", () => {
  it("applies 20% margin over wholesale duration cost for JSON responses", async () => {
    const meter = createMeter();
    const cost = await meter({
      request: makeRequest("/page"),
      response: jsonResponse({ markdown: "hi", title: "t", url: "u", durationMs: 4000 }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = retailPrice(wholesaleForDurationMs(4000), "1000000000", 2000);
    expect(cost).toBe(expected);
  });

  it("clamps to authorizedAmount when cost would exceed it", async () => {
    const meter = createMeter();
    const cost = await meter({
      request: makeRequest("/page"),
      response: jsonResponse({ durationMs: 30_000 }),
      authorizedAmount: "1", // 1 micro-USDC
      payer: PAYER,
    });
    expect(cost).toBe("1");
  });

  it("falls back to max wholesale (with margin) when durationMs missing", async () => {
    const meter = createMeter();
    const cost = await meter({
      request: makeRequest("/page"),
      response: jsonResponse({ markdown: "ok" }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = retailPrice(maxWholesaleCost(), "1000000000", 2000);
    expect(cost).toBe(expected);
  });

  it("reads durationMs from X-Scrape-Duration-Ms header (screenshot path)", async () => {
    const meter = createMeter();
    const binary = new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "X-Scrape-Duration-Ms": "7000",
      },
    });
    const cost = await meter({
      request: makeRequest("/screenshot"),
      response: binary,
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = retailPrice(wholesaleForDurationMs(7000), "1000000000", 2000);
    expect(cost).toBe(expected);
  });
});
