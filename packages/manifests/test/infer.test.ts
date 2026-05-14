import { describe, it, expect } from "vitest";
import { inferManifest, inferEntries } from "../src/index.js";
import type { ManifestParams } from "../src/index.js";

const params: ManifestParams = {
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  facilitator: "https://facilitator.x402cloud.ai",
  baseUrl: "https://infer.x402cloud.ai",
};

describe("inferManifest", () => {
  it("returns at least one service", () => {
    expect(inferManifest(params).length).toBeGreaterThan(0);
  });

  it("every entry uses the operator wallet as payTo", () => {
    for (const s of inferManifest(params)) {
      expect(s.payment.payTo).toBe(params.payTo);
    }
  });

  it("entries(p) and manifest(p) agree on id+maxPrice pairs", () => {
    const cat = inferManifest(params);
    const ent = inferEntries(params);
    expect(ent.length).toBe(cat.length);
    const m = new Map(cat.map((s) => [s.id, s.payment.maxPrice]));
    for (const e of ent) {
      expect(e.maxPrice).toBe(m.get(e.id));
    }
  });
});
