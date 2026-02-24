import { describe, it, expect } from "vitest";
import {
  computeTextCost,
  computeEmbedCost,
  computeImageCost,
  COST_PER_NEURON,
  MARKUP,
  BASE_FEE,
  IMAGE_NEURONS_PER_GEN,
} from "../src/pricing.js";

describe("pricing", () => {
  it("computeTextCost applies neuron formula with markup and base fee", () => {
    const neurons = { inputPerMillion: 10_000, outputPerMillion: 50_000 };
    const cost = computeTextCost(neurons, 1000, 2000);

    const expectedInput = (1000 / 1_000_000) * 10_000 * COST_PER_NEURON;
    const expectedOutput = (2000 / 1_000_000) * 50_000 * COST_PER_NEURON;
    const expected = (expectedInput + expectedOutput) * MARKUP + BASE_FEE;

    expect(cost).toBeCloseTo(expected, 10);
  });

  it("computeTextCost returns BASE_FEE for zero tokens", () => {
    const neurons = { inputPerMillion: 10_000, outputPerMillion: 50_000 };
    expect(computeTextCost(neurons, 0, 0)).toBeCloseTo(BASE_FEE, 10);
  });

  it("computeEmbedCost uses only input neurons", () => {
    const neurons = { inputPerMillion: 1_075, outputPerMillion: 999 };
    const cost = computeEmbedCost(neurons, 8192);

    const expectedInput = (8192 / 1_000_000) * 1_075 * COST_PER_NEURON;
    const expected = expectedInput * MARKUP + BASE_FEE;

    expect(cost).toBeCloseTo(expected, 10);
  });

  it("computeImageCost uses flat per-generation cost", () => {
    const cost = computeImageCost();
    const expected = IMAGE_NEURONS_PER_GEN * COST_PER_NEURON * MARKUP + BASE_FEE;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("computeImageCost accepts custom neuron count", () => {
    const cost = computeImageCost(100);
    const expected = 100 * COST_PER_NEURON * MARKUP + BASE_FEE;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("costs are always positive", () => {
    const neurons = { inputPerMillion: 1, outputPerMillion: 1 };
    expect(computeTextCost(neurons, 1, 1)).toBeGreaterThan(0);
    expect(computeEmbedCost(neurons, 1)).toBeGreaterThan(0);
    expect(computeImageCost(1)).toBeGreaterThan(0);
  });
});
