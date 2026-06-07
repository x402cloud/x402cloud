import { describe, it, expect } from "vitest";
import {
  WHOLESALE_PER_SECOND_USD,
  MAX_DURATION_MS,
  maxWholesaleCost,
  wholesaleForDurationMs,
} from "../src/pricing.js";

describe("wholesaleForDurationMs", () => {
  it("returns 0 for non-positive or non-finite duration", () => {
    expect(wholesaleForDurationMs(0)).toBe("0");
    expect(wholesaleForDurationMs(-100)).toBe("0");
    expect(wholesaleForDurationMs(Number.NaN)).toBe("0");
    expect(wholesaleForDurationMs(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("converts seconds × wholesale rate into micro-USDC", () => {
    // 10s × $0.0005/s = $0.005 = 5000 micro-USDC
    const expected = Math.round(10 * WHOLESALE_PER_SECOND_USD * 1_000_000).toString();
    expect(wholesaleForDurationMs(10_000)).toBe(expected);
  });

  it("caps duration at MAX_DURATION_MS", () => {
    const at60s = wholesaleForDurationMs(60_000);
    const atCap = wholesaleForDurationMs(MAX_DURATION_MS);
    expect(at60s).toBe(atCap);
    expect(at60s).toBe(maxWholesaleCost());
  });

  it("respects an explicit rate parameter", () => {
    // 1000ms = 1s; rate = $0.001/s → 1000 micro-USDC
    expect(wholesaleForDurationMs(1000, 0.001)).toBe("1000");
  });
});
