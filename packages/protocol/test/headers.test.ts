import { describe, it, expect } from "vitest";
import {
  encodePaymentHeader,
  decodePaymentHeader,
  encodeRequirementsHeader,
  decodeRequirementsHeader,
  extractPaymentHeader,
  parseUsdcAmount,
  formatUsdcAmount,
} from "../src/headers.js";
import type { PaymentPayload, PaymentRequired } from "../src/types.js";

const samplePayload: PaymentPayload = {
  x402Version: 1,
  resource: { url: "https://api.example.com/inference" },
  accepted: {
    scheme: "upto",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    maxAmount: "100000",
    payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
    maxTimeoutSeconds: 300,
  },
  payload: { signature: "0xabc123" },
};

const sampleRequirements: PaymentRequired = {
  x402Version: 1,
  resource: {
    url: "https://api.example.com/inference",
    description: "AI inference call",
  },
  accepts: [
    {
      scheme: "upto",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      maxAmount: "100000",
      payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
      maxTimeoutSeconds: 300,
    },
  ],
};

describe("encodePaymentHeader / decodePaymentHeader", () => {
  it("roundtrips a PaymentPayload", () => {
    const encoded = encodePaymentHeader(samplePayload);
    const decoded = decodePaymentHeader(encoded);
    expect(decoded).toEqual(samplePayload);
  });
});

describe("encodeRequirementsHeader / decodeRequirementsHeader", () => {
  it("roundtrips a PaymentRequired", () => {
    const encoded = encodeRequirementsHeader(sampleRequirements);
    const decoded = decodeRequirementsHeader(encoded);
    expect(decoded).toEqual(sampleRequirements);
  });
});

describe("extractPaymentHeader", () => {
  it("reads PAYMENT-SIGNATURE header (v2)", () => {
    const req = new Request("https://example.com", {
      headers: { "PAYMENT-SIGNATURE": "abc123" },
    });
    expect(extractPaymentHeader(req)).toBe("abc123");
  });

  it("reads X-PAYMENT header (v1 fallback)", () => {
    const req = new Request("https://example.com", {
      headers: { "X-PAYMENT": "xyz789" },
    });
    expect(extractPaymentHeader(req)).toBe("xyz789");
  });

  it("prefers PAYMENT-SIGNATURE over X-PAYMENT", () => {
    const req = new Request("https://example.com", {
      headers: {
        "PAYMENT-SIGNATURE": "v2value",
        "X-PAYMENT": "v1value",
      },
    });
    expect(extractPaymentHeader(req)).toBe("v2value");
  });

  it("returns null when no payment header is present", () => {
    const req = new Request("https://example.com");
    expect(extractPaymentHeader(req)).toBeNull();
  });
});

describe("parseUsdcAmount", () => {
  it.each([
    ["$0.10", "100000"],
    ["$1.00", "1000000"],
    ["$0.001", "1000"],
    ["0.013", "13000"],
    ["$10.50", "10500000"],
  ])("parses %s to %s", (input, expected) => {
    expect(parseUsdcAmount(input)).toBe(expected);
  });

  it("throws on empty string", () => {
    expect(() => parseUsdcAmount("")).toThrow("Invalid USDC amount");
  });

  it("throws on non-numeric input", () => {
    expect(() => parseUsdcAmount("abc")).toThrow("Invalid USDC amount");
  });

  it("throws on negative amount", () => {
    expect(() => parseUsdcAmount("-1.00")).toThrow("Invalid USDC amount");
  });
});

describe("formatUsdcAmount", () => {
  it.each([
    ["100000", "$0.100000"],
    ["1000000", "$1.000000"],
  ])("formats %s to %s", (input, expected) => {
    expect(formatUsdcAmount(input)).toBe(expected);
  });
});
