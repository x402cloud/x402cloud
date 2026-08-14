import { describe, it, expect, vi } from "vitest";
import { cachedFeeEstimator } from "../src/fee-cache.js";
import type { FeeEstimate } from "../src/fee.js";

function estimate(microUsdc: string): FeeEstimate {
  return { microUsdc, degraded: false };
}

describe("cachedFeeEstimator", () => {
  it("calls compute once per scheme, then serves the cache until TTL expires", async () => {
    let now = 0;
    const compute = vi.fn(async (scheme: string) => estimate(scheme === "upto" ? "100" : "200"));
    const get = cachedFeeEstimator(compute as never, 1000, () => now);

    expect(await get("upto" as never)).toEqual(estimate("100"));
    expect(await get("upto" as never)).toEqual(estimate("100"));
    expect(compute).toHaveBeenCalledTimes(1);

    now = 999; // still within TTL
    expect(await get("upto" as never)).toEqual(estimate("100"));
    expect(compute).toHaveBeenCalledTimes(1);

    now = 1000; // TTL boundary — expired (expiresAt = 0 + 1000, not > 1000)
    expect(await get("upto" as never)).toEqual(estimate("100"));
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("caches each scheme independently", async () => {
    let now = 0;
    const compute = vi.fn(async (scheme: string) => estimate(scheme === "upto" ? "100" : "200"));
    const get = cachedFeeEstimator(compute as never, 1000, () => now);

    expect(await get("upto" as never)).toEqual(estimate("100"));
    expect(await get("exact" as never)).toEqual(estimate("200"));
    expect(compute).toHaveBeenCalledTimes(2);

    expect(await get("upto" as never)).toEqual(estimate("100"));
    expect(await get("exact" as never)).toEqual(estimate("200"));
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes after the TTL expires, reflecting a fresh live read", async () => {
    let now = 0;
    let call = 0;
    const compute = vi.fn(async () => estimate(String(++call)));
    const get = cachedFeeEstimator(compute as never, 100, () => now);

    expect(await get("upto" as never)).toEqual(estimate("1"));
    now = 101;
    expect(await get("upto" as never)).toEqual(estimate("2"));
  });

  it("defaults to a 60s TTL and the real clock when not overridden", async () => {
    const compute = vi.fn(async () => estimate("42"));
    const get = cachedFeeEstimator(compute as never);
    expect(await get("upto" as never)).toEqual(estimate("42"));
    expect(await get("upto" as never)).toEqual(estimate("42"));
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
