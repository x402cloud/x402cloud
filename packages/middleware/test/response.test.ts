import { describe, it, expect } from "vitest";
import { buildPaymentRequired, buildExactPaymentRequired, buildRequirements } from "../src/response.js";
import type { UptoRouteConfig, ExactRouteConfig } from "../src/index.js";
import type { Network } from "@x402cloud/protocol";

const resourceUrl = "https://api.example.com/inference";
const payTo = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const facilitator = "0x9999999999999999999999999999999999999999" as const;

describe("buildPaymentRequired (upto)", () => {
  it("builds a PaymentRequired with default USDC for Base", () => {
    const cfg: UptoRouteConfig = {
      network: "eip155:8453",
      maxPrice: "$0.10",
      payTo,
      meter: () => "100000",
    };

    const result = buildPaymentRequired(cfg, resourceUrl, facilitator);

    expect(result.x402Version).toBe(2);
    expect(result.resource.url).toBe(resourceUrl);
    expect(result.resource.description).toBeUndefined();
    expect(result.accepts).toHaveLength(1);

    const req = result.accepts[0];
    expect(req.scheme).toBe("upto");
    expect(req.network).toBe("eip155:8453");
    expect(req.asset).toBe(baseUsdc);
    expect(req.amount).toBe("100000");
    expect(req.payTo).toBe(payTo);
    expect(req.maxTimeoutSeconds).toBe(300);
    // The canonical upto witness binds the settler, so the 402 advertises it.
    expect(req.extra).toEqual({ facilitator });
  });

  it("honors explicit asset override", () => {
    const custom = "0x1111111111111111111111111111111111111111";
    const cfg: UptoRouteConfig = {
      network: "eip155:8453",
      maxPrice: "$0.01",
      payTo,
      asset: custom,
      meter: () => "10000",
    };

    const result = buildPaymentRequired(cfg, resourceUrl, facilitator);
    expect(result.accepts[0].asset).toBe(custom);
  });

  it("honors maxTimeoutSeconds and description overrides", () => {
    const cfg: UptoRouteConfig = {
      network: "eip155:8453",
      maxPrice: "$1.00",
      payTo,
      maxTimeoutSeconds: 600,
      description: "Premium inference",
      meter: () => "1000000",
    };

    const result = buildPaymentRequired(cfg, resourceUrl, facilitator);
    expect(result.accepts[0].maxTimeoutSeconds).toBe(600);
    expect(result.resource.description).toBe("Premium inference");
  });

  it("throws when the network has no default USDC and no asset is provided", () => {
    const cfg: UptoRouteConfig = {
      network: "eip155:999999" as Network,
      maxPrice: "$0.10",
      payTo,
      meter: () => "100000",
    };

    expect(() => buildPaymentRequired(cfg, resourceUrl, facilitator)).toThrow(/No USDC address/);
  });

  it("parses maxPrice into smallest USDC units", () => {
    const cfg: UptoRouteConfig = {
      network: "eip155:8453",
      maxPrice: "$0.013",
      payTo,
      meter: () => "13000",
    };

    const result = buildPaymentRequired(cfg, resourceUrl, facilitator);
    expect(result.accepts[0].amount).toBe("13000");
  });
});

describe("buildExactPaymentRequired (exact)", () => {
  it("builds an exact scheme PaymentRequired with default USDC", () => {
    const cfg: ExactRouteConfig = {
      network: "eip155:8453",
      price: "$0.05",
      payTo,
    };

    const result = buildExactPaymentRequired(cfg, resourceUrl);

    expect(result.x402Version).toBe(2);
    expect(result.accepts[0].scheme).toBe("exact");
    expect(result.accepts[0].asset).toBe(baseUsdc);
    expect(result.accepts[0].amount).toBe("50000");
    expect(result.accepts[0].maxTimeoutSeconds).toBe(300);
  });

  it("uses `price` (not `maxPrice`) for the amount", () => {
    const cfg: ExactRouteConfig = {
      network: "eip155:8453",
      price: "$2.00",
      payTo,
    };

    const result = buildExactPaymentRequired(cfg, resourceUrl);
    expect(result.accepts[0].amount).toBe("2000000");
  });

  it("throws on unknown network without asset override", () => {
    const cfg: ExactRouteConfig = {
      network: "eip155:424242" as Network,
      price: "$0.05",
      payTo,
    };

    expect(() => buildExactPaymentRequired(cfg, resourceUrl)).toThrow(/No USDC address/);
  });

  it("allows unknown network when asset is explicitly provided", () => {
    const custom = "0x2222222222222222222222222222222222222222";
    const cfg: ExactRouteConfig = {
      network: "eip155:424242" as Network,
      price: "$0.05",
      payTo,
      asset: custom,
    };

    const result = buildExactPaymentRequired(cfg, resourceUrl);
    expect(result.accepts[0].asset).toBe(custom);
    expect(result.accepts[0].network).toBe("eip155:424242");
  });
});

describe("the 402 `error` string", () => {
  const cfg: UptoRouteConfig = {
    network: "eip155:8453",
    maxPrice: "$0.10",
    payTo,
    meter: () => "100000",
  };

  // The builder is public API. It cannot know why a caller is returning a 402,
  // so it does not invent a reason — asserting "the header is missing" on a
  // 402 returned for a failed signature would simply be false.
  it("is omitted when the caller gives none", () => {
    expect(buildPaymentRequired(cfg, resourceUrl, facilitator).error).toBeUndefined();
    expect(
      buildExactPaymentRequired({ network: "eip155:8453", price: "$0.05", payTo }, resourceUrl)
        .error,
    ).toBeUndefined();
  });

  it("is whatever the caller passed", () => {
    const result = buildPaymentRequired(cfg, resourceUrl, facilitator, "quota exhausted");

    expect(result.error).toBe("quota exhausted");
  });
});

describe("buildRequirements", () => {
  // One constructor: the offer we advertise and the requirements we verify
  // against come from here, so a new spec field is one edit, not two.
  it("applies the default asset and timeout", () => {
    const req = buildRequirements({
      scheme: "upto",
      network: "eip155:8453",
      amount: "100000",
      payTo,
    });

    expect(req).toEqual({
      scheme: "upto",
      network: "eip155:8453",
      asset: baseUsdc,
      amount: "100000",
      payTo,
      maxTimeoutSeconds: 300,
    });
  });

  it("omits `extra` entirely when none is given", () => {
    const req = buildRequirements({
      scheme: "exact",
      network: "eip155:8453",
      amount: "1",
      payTo,
    });

    expect(req).not.toHaveProperty("extra");
  });
});
