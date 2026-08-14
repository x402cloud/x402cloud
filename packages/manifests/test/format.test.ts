import { describe, it, expect } from "vitest";
import { microToUsdDisplay, retailDisplay } from "../src/format.js";

describe("microToUsdDisplay", () => {
  it("formats whole and fractional micro-USDC as $X.XXXXXX", () => {
    expect(microToUsdDisplay("1000000")).toBe("$1.000000");
    expect(microToUsdDisplay("1200000")).toBe("$1.200000");
    expect(microToUsdDisplay("4")).toBe("$0.000004");
  });
});

describe("retailDisplay (workspace#45 — fee floor headroom)", () => {
  it("defaults feeFloorMicro to 0 — unchanged from pre-workspace#45 behaviour", () => {
    expect(retailDisplay("1000000", 2000)).toBe("$1.200000");
  });

  it("a fee floor above the plain margin raises the displayed maxPrice", () => {
    // wholesale=4 micro-USDC, 20% margin rounds to 0 — with no floor the
    // retail is $0.000004. A 2000 micro-USDC floor must dominate.
    expect(retailDisplay("4", 2000)).toBe("$0.000004");
    expect(retailDisplay("4", 2000, "2000")).toBe("$0.002004");
  });

  it("a small fee floor never lowers the price below the plain margin", () => {
    expect(retailDisplay("1000000", 2000, "1")).toBe(retailDisplay("1000000", 2000));
  });
});
