import { describe, it, expect } from "vitest";
import { sandboxManifest, sandboxEntries } from "../src/index.js";
import type { ManifestParams } from "../src/index.js";

const params: ManifestParams = {
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  facilitator: "https://facilitator.x402cloud.ai",
  baseUrl: "https://sandbox.x402cloud.ai",
};

describe("sandboxManifest", () => {
  it("returns at least one service", () => {
    expect(sandboxManifest(params).length).toBeGreaterThan(0);
  });

  it("every entry uses the operator wallet as payTo", () => {
    for (const s of sandboxManifest(params)) {
      expect(s.payment.payTo).toBe(params.payTo);
    }
  });

  it("entries(p) and manifest(p) agree on id+maxPrice pairs", () => {
    const cat = sandboxManifest(params);
    const ent = sandboxEntries(params);
    expect(ent.length).toBe(cat.length);
    const m = new Map(cat.map((s) => [s.id, s.payment.maxPrice]));
    for (const e of ent) {
      expect(e.maxPrice).toBe(m.get(e.id));
    }
  });

  it("feeFloorMicro (workspace#45) defaults to 0 and, when set, raises maxPrice", () => {
    const noFloor = sandboxManifest(params)[0].payment.maxPrice;
    const withDefaultZero = sandboxManifest({ ...params, feeFloorMicro: "0" })[0].payment.maxPrice;
    expect(withDefaultZero).toBe(noFloor);

    const withFloor = sandboxManifest({ ...params, feeFloorMicro: "500000" })[0].payment.maxPrice;
    expect(withFloor).not.toBe(noFloor);
  });
});
