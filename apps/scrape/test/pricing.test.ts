import { describe, it, expect } from "vitest";
import {
  WHOLESALE_PER_REQUEST_USD,
  WHOLESALE_PER_SECOND_USD,
  MAX_DURATION_MS,
  maxWholesaleCost,
  wholesaleForDurationMs,
} from "../src/pricing.js";

describe("wholesaleForDurationMs", () => {
  it("charges only the per-request fee for zero or non-finite duration", () => {
    const fee = Math.round(WHOLESALE_PER_REQUEST_USD * 1_000_000).toString();
    expect(wholesaleForDurationMs(0)).toBe(fee);
    expect(wholesaleForDurationMs(-100)).toBe(fee);
    expect(wholesaleForDurationMs(Number.NaN)).toBe(fee);
    expect(wholesaleForDurationMs(Number.POSITIVE_INFINITY)).toBe(fee);
  });

  it("adds per-second cost for normal durations", () => {
    // 5s × $0.0001 = $0.0005, plus $0.001 fixed = $0.0015 = 1500 micro-USDC
    const expected = Math.round(
      (WHOLESALE_PER_REQUEST_USD + 5 * WHOLESALE_PER_SECOND_USD) * 1_000_000,
    ).toString();
    expect(wholesaleForDurationMs(5_000)).toBe(expected);
    expect(expected).toBe("1500");
  });

  it("caps duration at MAX_DURATION_MS", () => {
    const at60s = wholesaleForDurationMs(60_000);
    const atCap = wholesaleForDurationMs(MAX_DURATION_MS);
    expect(at60s).toBe(atCap);
    expect(at60s).toBe(maxWholesaleCost());
  });

  it("worst-case wholesale × 1.20 stays under the $0.005 catalog maxPrice", () => {
    const worstWholesale = BigInt(maxWholesaleCost());
    // applyMargin(2000bps) → × 12000 / 10000
    const worstRetail = (worstWholesale * 12_000n) / 10_000n;
    // $0.005 in micro-USDC = 5000
    expect(worstRetail).toBeLessThanOrEqual(5_000n);
  });

  it("handles very short requests (1ms) — pays per-request fee plus a sliver", () => {
    const out = wholesaleForDurationMs(1);
    // 1ms × $0.0001/s = $0.0000001 → rounds to 0 micro-USDC; total ≈ fee.
    expect(out).toBe(Math.round(WHOLESALE_PER_REQUEST_USD * 1_000_000).toString());
  });
});
