import { describe, it, expect } from "vitest";
import { normalizeRequirements, parseRequirements } from "../src/types.js";
import type { PaymentRequirementsInput } from "../src/types.js";

// A legal offer, minus the price. Typed as the INPUT shape, which is what an
// offer from outside actually is — no casts needed to express it.
const base: PaymentRequirementsInput = {
  scheme: "upto",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  maxTimeoutSeconds: 300,
};

describe("parseRequirements", () => {
  it("takes the price from the spec field `amount`", () => {
    const result = parseRequirements({ ...base, amount: "10000" });

    expect(result).toEqual({ ok: true, value: { ...base, amount: "10000" } });
  });

  it("accepts the legacy `maxAmount` spelling and canonicalizes it to `amount`", () => {
    const result = parseRequirements({ ...base, maxAmount: "10000" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBe("10000");
    // `maxAmount` does not survive parsing — in memory there is one price field.
    expect(result.value).not.toHaveProperty("maxAmount");
  });

  it("accepts both spellings when they agree", () => {
    const result = parseRequirements({ ...base, amount: "10000", maxAmount: "10000" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBe("10000");
  });

  // SECURITY: a hostile server can show a budget guard `amount: "1000"` while
  // asking a signer that prefers `maxAmount` to authorize a million times more.
  // Neither number is trustworthy once they disagree, so nothing is signed.
  it("rejects an offer whose two price spellings disagree", () => {
    const result = parseRequirements({ ...base, amount: "1000", maxAmount: "1000000000" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ambiguous/);
    expect(result.error).toContain("1000000000");
  });

  it("rejects an offer with no price at all", () => {
    const result = parseRequirements(base);

    expect(result).toEqual({ ok: false, error: "requirements has no price (`amount`)" });
  });

  it("rejects missing requirements without throwing", () => {
    expect(parseRequirements(undefined)).toEqual({ ok: false, error: "requirements missing" });
    expect(parseRequirements(null)).toEqual({ ok: false, error: "requirements missing" });
  });
});

describe("normalizeRequirements", () => {
  it("returns the parsed value", () => {
    expect(normalizeRequirements({ ...base, amount: "10000" }).amount).toBe("10000");
  });

  it("throws the parse error for a priceless offer", () => {
    expect(() => normalizeRequirements(base)).toThrow(/no price/);
  });

  it("throws rather than pick a side when the spellings disagree", () => {
    expect(() =>
      normalizeRequirements({ ...base, amount: "1000", maxAmount: "1000000000" }),
    ).toThrow(/ambiguous/);
  });
});
