import { describe, it, expect } from "vitest";
import { parseChainId, parseUnixSeconds, MAX_UNIX_SECONDS } from "../src/utils.js";
import { sanitizeErrorMessage } from "../src/errors.js";

describe("parseChainId", () => {
  it("parses eip155:8453 to 8453", () => {
    expect(parseChainId("eip155:8453")).toBe(8453);
  });

  it("parses eip155:84532 to 84532", () => {
    expect(parseChainId("eip155:84532")).toBe(84532);
  });

  it("throws on solana:mainnet", () => {
    expect(() => parseChainId("solana:mainnet" as `${string}:${string}`)).toThrow(
      "is not an EVM network"
    );
  });

  it("throws on invalid string", () => {
    expect(() => parseChainId("invalid" as `${string}:${string}`)).toThrow();
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

  it("rejects empty string", () => {
    expect(parseUnixSeconds("")).toBeNull();
  });

  it("rejects non-numeric", () => {
    expect(parseUnixSeconds("abc")).toBeNull();
  });

  it("rejects negative", () => {
    expect(parseUnixSeconds("-1")).toBeNull();
  });

  it("rejects values past MAX_UNIX_SECONDS — the parseInt overflow attack", () => {
    // parseInt("999999999999999999999") → Infinity, which would silently
    // pass any `< now` deadline check. parseUnixSeconds must reject it.
    expect(parseUnixSeconds("999999999999999999999")).toBeNull();
  });

  it("rejects floats and exponents", () => {
    expect(parseUnixSeconds("1.5")).toBeNull();
    expect(parseUnixSeconds("1e10")).toBeNull();
  });

  it("rejects whitespace", () => {
    expect(parseUnixSeconds(" 100 ")).toBeNull();
  });
});

describe("sanitizeErrorMessage", () => {
  it("preserves a short error", () => {
    expect(sanitizeErrorMessage(new Error("nonce already used"))).toBe("Error: nonce already used");
  });

  it("redacts long hex blobs (calldata, signatures)", () => {
    const sig = "0x" + "ab".repeat(33);
    const out = sanitizeErrorMessage(new Error(`reverted with ${sig}`));
    expect(out).toContain("[hex_redacted]");
    expect(out).not.toContain(sig);
  });

  it("redacts URLs (which may contain RPC API keys)", () => {
    const url = "https://eth-mainnet.g.alchemy.com/v2/SECRET_KEY_HERE";
    const out = sanitizeErrorMessage(new Error(`failed: ${url}`));
    expect(out).toContain("[url_redacted]");
    expect(out).not.toContain("SECRET_KEY_HERE");
  });

  it("keeps only the first line", () => {
    const err = new Error("first line\nsecond line\nthird line");
    expect(sanitizeErrorMessage(err)).toBe("Error: first line");
  });

  it("caps very long messages", () => {
    const out = sanitizeErrorMessage(new Error("x".repeat(500)));
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles non-Error throwables", () => {
    expect(sanitizeErrorMessage("plain string")).toBe("plain string");
    expect(sanitizeErrorMessage(42)).toBe("42");
  });
});
