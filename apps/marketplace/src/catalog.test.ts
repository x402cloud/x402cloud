import { describe, it, expect } from "vitest";
import { buildCatalog } from "./catalog.js";

const params = {
  network: "eip155:84532" as const,
  operatorAddress: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  facilitator: "https://facilitator.x402cloud.ai",
};

describe("buildCatalog", () => {
  it("returns a non-empty list", () => {
    const services = buildCatalog(params);
    expect(services.length).toBeGreaterThan(0);
  });

  it("includes inference, sandbox, and scraping categories", () => {
    const services = buildCatalog(params);
    const categories = new Set(services.map((s) => s.category));
    expect(categories.has("inference")).toBe(true);
    expect(categories.has("sandbox")).toBe(true);
    expect(categories.has("scraping")).toBe(true);
  });

  it("every service has the operator as payTo (merchant of record)", () => {
    const services = buildCatalog(params);
    for (const s of services) {
      expect(s.payment.payTo).toBe(params.operatorAddress);
    }
  });

  it("every service uses the configured facilitator", () => {
    const services = buildCatalog(params);
    for (const s of services) {
      expect(s.payment.facilitator).toBe(params.facilitator);
    }
  });

  it("every service uses x402 upto on the configured network", () => {
    const services = buildCatalog(params);
    for (const s of services) {
      expect(s.payment.protocol).toBe("x402");
      expect(s.payment.scheme).toBe("upto");
      expect(s.payment.network).toBe(params.network);
    }
  });

  it("service ids are unique", () => {
    const services = buildCatalog(params);
    const ids = services.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws on unknown network", () => {
    expect(() =>
      buildCatalog({ ...params, network: "eip155:999999999" as const }),
    ).toThrow();
  });
});
