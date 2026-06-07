import { describe, it, expect } from "vitest";
import {
  wholesaleTextCost,
  wholesaleEmbedCost,
  wholesaleImageCost,
  MICRO_USDC_PER_NEURON,
  IMAGE_NEURONS_PER_GEN,
  IMAGE_NEURONS_PER_GEN_SCALED_10,
} from "../src/pricing.js";

/**
 * Pricing is wholesale-only: every output is micro-USDC (decimal string),
 * no markup, no base fee. Markup lives in `meter.ts` via `retailPrice`.
 */
describe("pricing (wholesale, BigInt micro-USDC)", () => {
  it("MICRO_USDC_PER_NEURON encodes $0.000011/neuron as 11 micro-USDC", () => {
    expect(MICRO_USDC_PER_NEURON).toBe(11n);
  });

  it("IMAGE_NEURONS_PER_GEN_SCALED_10 preserves 172.8 with one decimal", () => {
    expect(IMAGE_NEURONS_PER_GEN_SCALED_10).toBe(1728n);
    expect(IMAGE_NEURONS_PER_GEN).toBe(172.8);
  });

  it("wholesaleTextCost applies neuron formula with no markup", () => {
    const neurons = { inputPerMillion: 10_000, outputPerMillion: 50_000 };
    // (1000*10_000 + 2000*50_000) * 11 / 1_000_000
    // = (10_000_000 + 100_000_000) * 11 / 1_000_000
    // = 110_000_000 * 11 / 1_000_000
    // = 1_210_000_000 / 1_000_000 = 1210 micro-USDC
    expect(wholesaleTextCost(neurons, 1000, 2000)).toBe("1210");
  });

  it("wholesaleTextCost returns 0 for zero tokens (no base fee)", () => {
    const neurons = { inputPerMillion: 10_000, outputPerMillion: 50_000 };
    expect(wholesaleTextCost(neurons, 0, 0)).toBe("0");
  });

  it("wholesaleTextCost truncates sub-micro fractions (no float drift)", () => {
    // 1 input token at 1 neuron/M: (1 * 1) * 11 / 1_000_000 = 11/1e6 = 0 (truncated)
    const neurons = { inputPerMillion: 1, outputPerMillion: 1 };
    expect(wholesaleTextCost(neurons, 1, 0)).toBe("0");
  });

  it("wholesaleEmbedCost uses only input neurons", () => {
    const neurons = { inputPerMillion: 1_075, outputPerMillion: 999 };
    // 8192 * 1075 * 11 / 1_000_000 = 96_870_400 / 1_000_000 = 96 micro-USDC
    expect(wholesaleEmbedCost(neurons, 8192)).toBe("96");
  });

  it("wholesaleEmbedCost is zero for zero tokens", () => {
    const neurons = { inputPerMillion: 1_075, outputPerMillion: 0 };
    expect(wholesaleEmbedCost(neurons, 0)).toBe("0");
  });

  it("wholesaleImageCost uses 172.8 neurons * 11 micro-USDC = 1900 (truncated)", () => {
    // (172.8 * 10) * 11 / 10 = 1728 * 11 / 10 = 19008/10 = 1900
    expect(wholesaleImageCost()).toBe("1900");
  });

  it("wholesaleImageCost accepts a custom neuron count", () => {
    // 100 * 10 * 11 / 10 = 1100
    expect(wholesaleImageCost(100)).toBe("1100");
  });

  it("wholesaleImageCost rounds fractional input neurons once", () => {
    // 1.5 -> scaled 15 -> 15 * 11 / 10 = 165/10 = 16
    expect(wholesaleImageCost(1.5)).toBe("16");
  });

  it("wholesale costs are non-negative", () => {
    const neurons = { inputPerMillion: 1, outputPerMillion: 1 };
    expect(BigInt(wholesaleTextCost(neurons, 1_000_000, 1_000_000))).toBeGreaterThanOrEqual(0n);
    expect(BigInt(wholesaleEmbedCost(neurons, 1_000_000))).toBeGreaterThanOrEqual(0n);
    expect(BigInt(wholesaleImageCost(1))).toBeGreaterThanOrEqual(0n);
  });

  it("clamps negative or non-finite token inputs to zero", () => {
    const neurons = { inputPerMillion: 10_000, outputPerMillion: 10_000 };
    expect(wholesaleTextCost(neurons, -5, 100)).toBe(
      wholesaleTextCost(neurons, 0, 100),
    );
    expect(wholesaleEmbedCost(neurons, -5)).toBe("0");
  });
});
