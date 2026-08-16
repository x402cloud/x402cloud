import { describe, it, expect } from "vitest";
import {
  isCasperNetwork,
  assertCasperNetwork,
  parseUnixSeconds,
  parseMotes,
  csprToMotes,
  formatMotes,
  MAX_UNIX_SECONDS,
} from "../src/utils.js";
import { resolveNetwork, wcsprContract, MOTES_PER_CSPR } from "../src/constants.js";
import { sanitizeErrorMessage } from "../src/errors.js";

describe("isCasperNetwork", () => {
  it("accepts casper:casper", () => {
    expect(isCasperNetwork("casper:casper")).toBe(true);
  });

  it("accepts casper:casper-test", () => {
    expect(isCasperNetwork("casper:casper-test")).toBe(true);
  });

  it("rejects EVM networks", () => {
    expect(isCasperNetwork("eip155:8453")).toBe(false);
  });

  it("rejects a casper-prefixed but unknown chain", () => {
    expect(isCasperNetwork("casper:integration-test")).toBe(false);
  });
});

describe("assertCasperNetwork", () => {
  it("returns the network when supported", () => {
    expect(assertCasperNetwork("casper:casper")).toBe("casper:casper");
  });

  it("throws on eip155:8453", () => {
    expect(() => assertCasperNetwork("eip155:8453")).toThrow("is not a Casper network");
  });
});

describe("resolveNetwork", () => {
  it("resolves casper to mainnet", () => {
    expect(resolveNetwork("casper")).toBe("casper:casper");
  });

  it("resolves casper-testnet to the test chain", () => {
    expect(resolveNetwork("casper-testnet")).toBe("casper:casper-test");
  });

  it("throws on unknown names", () => {
    expect(() => resolveNetwork("cspr")).toThrow("Unknown network");
  });
});

describe("parseUnixSeconds", () => {
  it("parses a normal timestamp", () => {
    expect(parseUnixSeconds("1700000000")).toBe(1700000000n);
  });

  it("parses zero", () => {
    expect(parseUnixSeconds("0")).toBe(0n);
  });

  it("parses MAX_UNIX_SECONDS", () => {
    expect(parseUnixSeconds(MAX_UNIX_SECONDS.toString())).toBe(MAX_UNIX_SECONDS);
  });

  it("rejects empty, non-numeric and negative input", () => {
    expect(parseUnixSeconds("")).toBeNull();
    expect(parseUnixSeconds("abc")).toBeNull();
    expect(parseUnixSeconds("-1")).toBeNull();
  });

  it("rejects values past MAX_UNIX_SECONDS — the parseInt overflow attack", () => {
    expect(parseUnixSeconds("999999999999999999999")).toBeNull();
  });

  it("rejects floats, exponents and whitespace", () => {
    expect(parseUnixSeconds("1.5")).toBeNull();
    expect(parseUnixSeconds("1e10")).toBeNull();
    expect(parseUnixSeconds(" 100 ")).toBeNull();
  });
});

describe("parseMotes", () => {
  it("parses an integer mote amount", () => {
    expect(parseMotes("2500000000")).toBe(2_500_000_000n);
  });

  it("parses amounts far beyond Number.MAX_SAFE_INTEGER without loss", () => {
    const huge = "123456789012345678901234567890";
    expect(parseMotes(huge)).toBe(BigInt(huge));
  });

  it("rejects decimals — motes are indivisible", () => {
    expect(parseMotes("1.5")).toBeNull();
  });

  it("rejects negatives, exponents, whitespace and empty input", () => {
    expect(parseMotes("-1")).toBeNull();
    expect(parseMotes("1e9")).toBeNull();
    expect(parseMotes(" 1 ")).toBeNull();
    expect(parseMotes("")).toBeNull();
  });
});

describe("csprToMotes", () => {
  it("converts whole CSPR", () => {
    expect(csprToMotes("1")).toBe(MOTES_PER_CSPR);
    expect(csprToMotes("0")).toBe(0n);
  });

  it("converts fractional CSPR exactly", () => {
    expect(csprToMotes("1.25")).toBe(1_250_000_000n);
    expect(csprToMotes("0.000000001")).toBe(1n);
  });

  it("THROWS on sub-mote precision instead of truncating", () => {
    // 10 decimals — the last digit cannot be represented in motes. Silently
    // dropping it would desynchronise the charge from the signed amount.
    expect(() => csprToMotes("0.0000000001")).toThrow("sub-mote precision");
    expect(() => csprToMotes("1.1234567891")).toThrow("sub-mote precision");
  });

  it("rejects non-numeric, negative and empty input", () => {
    expect(() => csprToMotes("abc")).toThrow();
    expect(() => csprToMotes("-1")).toThrow();
    expect(() => csprToMotes("")).toThrow();
  });

  it("handles very large amounts without floating-point drift", () => {
    expect(csprToMotes("9007199254740993.000000001")).toBe(
      9007199254740993n * MOTES_PER_CSPR + 1n,
    );
  });
});

describe("formatMotes", () => {
  it("formats whole CSPR", () => {
    expect(formatMotes(MOTES_PER_CSPR)).toBe("1");
    expect(formatMotes(0n)).toBe("0");
  });

  it("formats fractional amounts and trims trailing zeros", () => {
    expect(formatMotes(1_250_000_000n)).toBe("1.25");
    expect(formatMotes(1n)).toBe("0.000000001");
  });

  it("round-trips with csprToMotes", () => {
    for (const v of ["0", "1", "1.25", "0.000000001", "123456.789"]) {
      expect(formatMotes(csprToMotes(v))).toBe(v === "0" ? "0" : v.replace(/\.?0+$/, "") || "0");
    }
  });

  it("throws on non-bigint input", () => {
    expect(() => formatMotes("1" as unknown as bigint)).toThrow();
  });
});

describe("wcsprContract", () => {
  it("reads the mainnet contract from CASPER_WCSPR_CONTRACT", () => {
    expect(wcsprContract("casper:casper", { CASPER_WCSPR_CONTRACT: "hash-abc" })).toBe("hash-abc");
  });

  it("reads the testnet contract from CASPER_TESTNET_WCSPR_CONTRACT", () => {
    expect(
      wcsprContract("casper:casper-test", { CASPER_TESTNET_WCSPR_CONTRACT: "hash-def" }),
    ).toBe("hash-def");
  });

  it("does not cross networks", () => {
    expect(wcsprContract("casper:casper-test", { CASPER_WCSPR_CONTRACT: "hash-abc" })).toBeUndefined();
  });

  it("returns undefined when unconfigured", () => {
    expect(wcsprContract("casper:casper", {})).toBeUndefined();
    expect(wcsprContract("casper:casper", { CASPER_WCSPR_CONTRACT: "" })).toBeUndefined();
  });
});

describe("sanitizeErrorMessage", () => {
  it("preserves a short error", () => {
    expect(sanitizeErrorMessage(new Error("nonce already used"))).toBe("Error: nonce already used");
  });

  it("redacts long hex blobs (deploy hashes, signatures)", () => {
    const hash = "ab".repeat(33);
    const out = sanitizeErrorMessage(new Error(`deploy failed ${hash}`));
    expect(out).toContain("[hex_redacted]");
    expect(out).not.toContain(hash);
  });

  it("redacts URLs (which may contain access tokens)", () => {
    const url = "https://x402-facilitator.cspr.cloud/v1/SECRET_TOKEN";
    const out = sanitizeErrorMessage(new Error(`failed: ${url}`));
    expect(out).toContain("[url_redacted]");
    expect(out).not.toContain("SECRET_TOKEN");
  });

  it("keeps only the first line", () => {
    expect(sanitizeErrorMessage(new Error("first\nsecond"))).toBe("Error: first");
  });

  it("caps very long messages", () => {
    const out = sanitizeErrorMessage(new Error("x".repeat(1000)));
    expect(out.length).toBeLessThanOrEqual(241);
  });

  it("handles non-Error values", () => {
    expect(sanitizeErrorMessage("plain string")).toBe("plain string");
  });
});
