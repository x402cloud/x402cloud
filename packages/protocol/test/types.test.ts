import { describe, it, expect } from "vitest";
import { normalizeRequirements } from "../src/types.js";
import type { PaymentRequirements } from "../src/types.js";

const base = {
  scheme: "upto",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  maxTimeoutSeconds: 300,
} as const;

describe("normalizeRequirements", () => {
  it("fills `maxAmount` from a spec-conformant offer carrying only `amount`", () => {
    const result = normalizeRequirements({ ...base, amount: "10000" } as PaymentRequirements);

    expect(result.maxAmount).toBe("10000");
    expect(result.amount).toBe("10000");
  });

  it("fills `amount` from a legacy offer carrying only `maxAmount`", () => {
    const result = normalizeRequirements({ ...base, maxAmount: "10000" } as PaymentRequirements);

    expect(result.amount).toBe("10000");
    expect(result.maxAmount).toBe("10000");
  });

  it("throws when the offer carries no price at all", () => {
    expect(() => normalizeRequirements(base as PaymentRequirements)).toThrow(
      /missing both `amount` and `maxAmount`/,
    );
  });
});
