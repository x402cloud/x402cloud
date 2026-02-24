import { describe, it, expect } from "vitest";
import { parseChainId } from "../src/utils.js";

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
