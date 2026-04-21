import { describe, it, expect } from "vitest";
import { resolveScheme, isX402Settlement } from "../src/scan-logs.js";
import { UPTO_PROXY, EXACT_PROXY } from "../src/constants.js";
import type { RpcTransaction } from "../src/types.js";

function mkTx(to: string | null): RpcTransaction {
  return {
    hash: "0xhash",
    from: "0xfrom",
    to,
    input: "0x",
    gasPrice: "0x1",
  };
}

describe("resolveScheme", () => {
  it('returns "unknown" when tx.to is null (contract creation)', () => {
    expect(resolveScheme(mkTx(null))).toBe("unknown");
  });

  it('returns "upto" for the upto proxy address (lowercase)', () => {
    expect(resolveScheme(mkTx(UPTO_PROXY))).toBe("upto");
  });

  it('returns "upto" for the upto proxy address (checksummed input)', () => {
    // resolveScheme lowercases internally, so a checksummed address must still match
    expect(resolveScheme(mkTx("0x4020633461b2895a48930Ff97eE8fCdE8E520002"))).toBe("upto");
  });

  it('returns "exact" for the exact proxy address', () => {
    expect(resolveScheme(mkTx(EXACT_PROXY))).toBe("exact");
  });

  it('returns "exact" for any other destination (EIP-3009 transferWithAuthorization path)', () => {
    // USDC on Base Sepolia
    expect(resolveScheme(mkTx("0x036CbD53842c5426634e7929541eC2318f3dCF7e"))).toBe("exact");
  });
});

describe("isX402Settlement", () => {
  it("returns false when tx.to is null", () => {
    expect(isX402Settlement(mkTx(null))).toBe(false);
  });

  it("returns true for the upto proxy", () => {
    expect(isX402Settlement(mkTx(UPTO_PROXY))).toBe(true);
  });

  it("returns true for the exact proxy", () => {
    expect(isX402Settlement(mkTx(EXACT_PROXY))).toBe(true);
  });

  it("returns true for checksummed proxy address (case-insensitive match)", () => {
    expect(isX402Settlement(mkTx("0x4020615294c913F045dc10f0a5cdEbd86c280001"))).toBe(true);
  });

  it("returns false for arbitrary non-proxy destinations", () => {
    expect(isX402Settlement(mkTx("0x036CbD53842c5426634e7929541eC2318f3dCF7e"))).toBe(false);
    expect(isX402Settlement(mkTx("0x0000000000000000000000000000000000000000"))).toBe(false);
  });
});
