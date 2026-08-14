import { describe, it, expect } from "vitest";
import { applyMargin, clampToAuthorized, computeTake, retailPrice, DEFAULT_MARGIN_BPS } from "../src/margin.js";

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

  it("defaults feeFloor to 0 — identical to pre-workspace#45 behaviour", () => {
    // A wholesale so small that 20% of it rounds to 0 — with no floor the
    // retail price equals the wholesale cost exactly (the marketplace takes
    // nothing on this call, which is the pre-existing, pre-floor behaviour).
    expect(retailPrice("4", "1000000")).toBe("4");
  });

  describe("floor semantics (workspace#45 — no call settles at a loss)", () => {
    it("micro call: floor wins over a percentage that would round to ~0", () => {
      // wholesale=4 micro-USDC, 20% margin -> 0 (floor division). A computed
      // fee floor of 2000 micro-USDC must win, guaranteeing the take covers
      // the settlement cost rather than under-charging on a rounding artifact.
      expect(retailPrice("4", "1000000000", DEFAULT_MARGIN_BPS, "2000")).toBe("2004");
    });

    it("big call: percentage margin wins over a small floor — fee is absorbed", () => {
      // wholesale=1 USDC, 20% margin = 200000 micro-USDC take, far above a
      // 2000 micro-USDC gas floor. Headline rate stays the competitive 20%.
      expect(retailPrice("1000000", "10000000", DEFAULT_MARGIN_BPS, "2000")).toBe("1200000");
    });

    it("floor still clamps to the agent's authorization", () => {
      // Even the floor cannot exceed what the agent signed for.
      expect(retailPrice("4", "10", DEFAULT_MARGIN_BPS, "2000")).toBe("10");
    });

    it("rejects a negative feeFloor", () => {
      expect(() => retailPrice("1000", "10000", DEFAULT_MARGIN_BPS, "-1")).toThrow();
    });
  });

  describe("property: take never falls below the fee floor (workspace#45)", () => {
    // No fast-check dependency in this workspace — a dense, deterministic
    // sweep over wholesale/margin/floor combinations stands in for it. Every
    // combination must satisfy: whenever a settle fires (i.e. `authorized` is
    // never the binding constraint), take >= feeFloor.
    const wholesaleValues = ["0", "1", "4", "17", "333", "1000", "50000", "1000000", "987654321"];
    const marginBpsValues = [0, 1, 100, 2000, 5000, 10000];
    const feeFloorValues = ["0", "1", "500", "2000", "999999", "123456789"];

    it("computeTake(w, m, floor) >= floor for every combination", () => {
      for (const wholesale of wholesaleValues) {
        for (const marginBps of marginBpsValues) {
          for (const feeFloor of feeFloorValues) {
            const take = BigInt(computeTake(wholesale, marginBps, feeFloor));
            expect(take >= BigInt(feeFloor)).toBe(true);
          }
        }
      }
    });

    it("retailPrice(w, authorized=huge, m, floor) - w >= floor for every combination", () => {
      // Authorized is set far above any possible retail value in this sweep,
      // so clampToAuthorized never binds and the inequality is meaningful —
      // it is exactly the "whenever a settle fires, take >= computed fee
      // estimate" property from workspace#45's done-when list.
      const hugeAuthorized = "999999999999999";
      for (const wholesale of wholesaleValues) {
        for (const marginBps of marginBpsValues) {
          for (const feeFloor of feeFloorValues) {
            const retail = BigInt(retailPrice(wholesale, hugeAuthorized, marginBps, feeFloor));
            const take = retail - BigInt(wholesale);
            expect(take >= BigInt(feeFloor)).toBe(true);
          }
        }
      }
    });
  });
});
