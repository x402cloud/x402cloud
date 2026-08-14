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

  describe("feeFloorMicro (workspace#45 — 402 ceiling headroom)", () => {
    it("defaults to 0 — identical maxPrice to before workspace#45", () => {
      const withDefault = inferManifest(params);
      const withExplicitZero = inferManifest({ ...params, feeFloorMicro: "0" });
      expect(withDefault.map((s) => s.payment.maxPrice)).toEqual(
        withExplicitZero.map((s) => s.payment.maxPrice),
      );
    });

    it("a large fee floor raises maxPrice on the cheapest (image) row", () => {
      const noFloor = inferManifest(params).find((s) => s.id === "infer-image")!;
      const withFloor = inferManifest({ ...params, feeFloorMicro: "5000" }).find(
        (s) => s.id === "infer-image",
      )!;
      expect(withFloor.payment.maxPrice).not.toBe(noFloor.payment.maxPrice);
      // Both entries() and manifest() must move together.
      const entWithFloor = inferEntries({ ...params, feeFloorMicro: "5000" }).find(
        (e) => e.id === "infer-image",
      )!;
      expect(entWithFloor.maxPrice).toBe(withFloor.payment.maxPrice);
    });
  });
});
