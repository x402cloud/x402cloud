import { describe, it, expect } from "vitest";
import {
  proxyAddresses,
  PROXY_ADDRESSES,
  X402_EXACT_PROXY,
  X402_UPTO_PROXY,
} from "../src/constants.js";

describe("proxyAddresses", () => {
  it("resolves the canonical CREATE2 proxies for Base Sepolia", () => {
    expect(proxyAddresses("eip155:84532")).toEqual({
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    });
  });

  it("resolves the same canonical CREATE2 proxies for Base mainnet", () => {
    expect(proxyAddresses("eip155:8453")).toEqual({
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    });
  });

  it("falls back to the canonical constants for any unlisted chain", () => {
    expect(proxyAddresses("eip155:1")).toEqual({
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    });
  });

  it("uses the canonical Coinbase CREATE2 addresses", () => {
    expect(X402_EXACT_PROXY).toBe("0x402085c248EeA27D92E8b30b2C58ed07f9E20001");
    expect(X402_UPTO_PROXY).toBe("0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002");
  });

  it("lists both Base networks in a frozen map", () => {
    expect(Object.keys(PROXY_ADDRESSES).sort()).toEqual(["eip155:84532", "eip155:8453"].sort());
    expect(Object.isFrozen(PROXY_ADDRESSES)).toBe(true);
  });
});
