import { describe, it, expect } from "vitest";
import { applyMargin, clampToAuthorized, retailPrice, DEFAULT_MARGIN_BPS } from "../src/margin.js";

describe("applyMargin", () => {
  it("applies 20% margin (default 2000 bps)", () => {
    expect(applyMargin("1000000")).toBe("1200000");
  });

  it("applies arbitrary margin in basis points", () => {
    expect(applyMargin("1000000", 1500)).toBe("1150000"); // 15%
    expect(applyMargin("1000000", 0)).toBe("1000000");    // pass-through
    expect(applyMargin("1000000", 10000)).toBe("2000000"); // 100%
  });

  it("rounds down (integer division)", () => {
    // 333 * 1.20 = 399.6 -> floor to 399
    expect(applyMargin("333", 2000)).toBe("399");
  });

  it("rejects negative margin", () => {
    expect(() => applyMargin("100", -1)).toThrow();
  });

  it("handles very large amounts without overflow", () => {
    const big = "1000000000000000000"; // 1e18, far above any USDC amount
    expect(applyMargin(big, 2000)).toBe("1200000000000000000");
  });

  it("DEFAULT_MARGIN_BPS is 2000 (20%)", () => {
    expect(DEFAULT_MARGIN_BPS).toBe(2000);
  });
});

describe("clampToAuthorized", () => {
  it("returns cost when below authorized", () => {
    expect(clampToAuthorized("500", "1000")).toBe("500");
  });

  it("returns authorized when cost exceeds it", () => {
    expect(clampToAuthorized("1500", "1000")).toBe("1000");
  });

  it("returns either when equal", () => {
    expect(clampToAuthorized("1000", "1000")).toBe("1000");
  });
});

describe("retailPrice", () => {
  it("applies margin then clamps to authorized", () => {
    // 1 USDC wholesale, 20% margin -> 1.2 USDC retail
    // Authorized 2 USDC -> retail wins
    expect(retailPrice("1000000", "2000000")).toBe("1200000");
  });

  it("clamps when retail exceeds authorized", () => {
    // 1 USDC wholesale, 20% margin -> 1.2 USDC retail
    // Authorized only 1.1 USDC -> clamp to authorized
    expect(retailPrice("1000000", "1100000")).toBe("1100000");
  });

  it("honours custom margin", () => {
    expect(retailPrice("1000000", "10000000", 5000)).toBe("1500000"); // 50% margin
  });
});
