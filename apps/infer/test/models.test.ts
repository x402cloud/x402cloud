import { describe, it, expect } from "vitest";
import { MODELS } from "../src/models.js";

describe("MODELS", () => {
  it("contains expected model keys", () => {
    const keys = Object.keys(MODELS);
    expect(keys).toContain("fast");
    expect(keys).toContain("nano");
    expect(keys).toContain("embed");
    expect(keys).toContain("image");
  });

  it("every model has required fields", () => {
    for (const [name, config] of Object.entries(MODELS)) {
      expect(config.model, `${name}.model`).toBeTruthy();
      expect(config.type, `${name}.type`).toMatch(/^(text|embed|image)$/);
      expect(config.description, `${name}.description`).toBeTruthy();
      expect(config.maxPrice, `${name}.maxPrice`).toMatch(/^\$/);
      expect(config.neurons, `${name}.neurons`).toBeDefined();
    }
  });

  it("maxPrice is a valid dollar string", () => {
    for (const [name, config] of Object.entries(MODELS)) {
      const parsed = parseFloat(config.maxPrice.replace("$", ""));
      expect(parsed, `${name}.maxPrice should be a positive number`).toBeGreaterThan(0);
    }
  });

  it("text models have non-zero output neurons", () => {
    for (const [name, config] of Object.entries(MODELS)) {
      if (config.type === "text") {
        expect(config.neurons.outputPerMillion, `${name} should have output neurons`).toBeGreaterThan(0);
      }
    }
  });

  it("embed model has zero output neurons", () => {
    const embed = MODELS["embed"];
    if (embed) {
      expect(embed.neurons.outputPerMillion).toBe(0);
    }
  });
});
