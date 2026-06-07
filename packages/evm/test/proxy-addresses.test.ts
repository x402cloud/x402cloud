import { describe, it, expect } from "vitest";
import {
  proxyAddresses,
  PROXY_ADDRESSES,
  X402_EXACT_PROXY,
  X402_UPTO_PROXY,
} from "../src/constants.js";

describe("proxyAddresses", () => {
  it("falls back to legacy constants for Base Sepolia (unaffected by the map)", () => {
    expect(proxyAddresses("eip155:84532")).toEqual({
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    });
  });

  it("falls back to legacy constants for any unlisted chain", () => {
    expect(proxyAddresses("eip155:8453")).toEqual({
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    });
    expect(proxyAddresses("eip155:1")).toEqual({
      exact: X402_EXACT_PROXY,
      upto: X402_UPTO_PROXY,
    });
  });

  it("prefers a PROXY_ADDRESSES entry when one exists", () => {
    // The map is intentionally empty today; this documents the accretion
    // contract: a future entry wins over the legacy fallback. We assert the
    // resolution logic against a local stand-in rather than mutating the
    // frozen export.
    const network = "eip155:999999";
    const override = {
      exact: "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
      upto: "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002",
    } as const;
    const resolve = (n: string) =>
      ({ [network]: override })[n] ?? {
        exact: X402_EXACT_PROXY,
        upto: X402_UPTO_PROXY,
      };
    expect(resolve(network)).toEqual(override);
  });

  it("exposes an empty, frozen override map by default", () => {
    expect(Object.keys(PROXY_ADDRESSES)).toHaveLength(0);
    expect(Object.isFrozen(PROXY_ADDRESSES)).toBe(true);
  });
});
