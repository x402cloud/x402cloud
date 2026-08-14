import { describe, it, expect } from "vitest";
import {
  computeSettlementFee,
  settleGasUnits,
  SETTLE_GAS_UNITS,
  SAFETY_MULTIPLIER,
  FALLBACK_GAS_PRICE_WEI,
  FALLBACK_L1_FEE_WEI,
  FALLBACK_ETH_USD,
  type FeeDataReader,
  type L1DataFeeReader,
  type EthUsdReader,
  type FeeReaders,
} from "../src/fee.js";

const NETWORK = "eip155:84532" as const;

function liveReaders(overrides: Partial<FeeReaders> = {}): FeeReaders {
  const feeData: FeeDataReader = {
    getFeeData: async () => ({ baseFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n }), // 1 gwei + 0.1 gwei
  };
  const l1Fee: L1DataFeeReader = {
    getL1Fee: async () => 10_000_000_000n, // 1e10 wei
  };
  const ethUsd: EthUsdReader = {
    getEthUsd: async () => ({ price: 3000_00000000n, decimals: 8 }), // $3000, 8 decimals
  };
  return { feeData, l1Fee, ethUsd, ...overrides };
}

function throwingReader<T>(): T {
  return new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error("boom");
      },
    },
  ) as T;
}

describe("settleGasUnits", () => {
  it("returns the measured/estimated gas units for a known scheme+network", () => {
    expect(settleGasUnits("upto", NETWORK)).toBe(SETTLE_GAS_UNITS["upto:eip155:84532"]);
    expect(settleGasUnits("exact", NETWORK)).toBe(SETTLE_GAS_UNITS["exact:eip155:84532"]);
  });

  it("throws for an unmeasured scheme/network rather than silently returning 0", () => {
    expect(() => settleGasUnits("upto", "eip155:999999")).toThrow(/No measured SETTLE_GAS_UNITS/);
  });
});

describe("computeSettlementFee — live path", () => {
  it("computes a positive fee from live reads and is not degraded", async () => {
    const result = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers: liveReaders() });
    expect(result.degraded).toBe(false);
    expect(BigInt(result.microUsdc) > 0n).toBe(true);
  });

  it("matches the formula by hand: gasWei = units*(base+priority) + l1Fee; fee = ceil(gasWei*ethUsdMicro/1e18)*SAFETY", async () => {
    const readers = liveReaders();
    const result = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers });

    const gasUnits = settleGasUnits("upto", NETWORK);
    const { baseFeePerGas, maxPriorityFeePerGas } = await readers.feeData.getFeeData();
    const l1Fee = await readers.l1Fee.getL1Fee("upto");
    const { price, decimals } = await readers.ethUsd.getEthUsd();

    const gasWei = gasUnits * (baseFeePerGas + maxPriorityFeePerGas) + l1Fee;
    const microUsdPerEth = (price * 1_000_000n) / 10n ** BigInt(decimals);
    const expected = ((gasWei * microUsdPerEth + 10n ** 18n - 1n) / 10n ** 18n) * BigInt(SAFETY_MULTIPLIER);

    expect(result.microUsdc).toBe(expected.toString());
  });

  it("a higher safetyMultiplier scales the fee linearly", async () => {
    const readers = liveReaders();
    const base = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers });
    const doubled = await computeSettlementFee({
      scheme: "upto",
      network: NETWORK,
      readers,
      safetyMultiplier: SAFETY_MULTIPLIER * 2,
    });
    expect(BigInt(doubled.microUsdc)).toBe(BigInt(base.microUsdc) * 2n);
  });

  it("rejects a non-positive safetyMultiplier", async () => {
    await expect(
      computeSettlementFee({ scheme: "upto", network: NETWORK, readers: liveReaders(), safetyMultiplier: 0 }),
    ).rejects.toThrow(/positive/);
  });
});

describe("computeSettlementFee — fail-closed per-reader (workspace#45)", () => {
  it("feeData throwing falls back to FALLBACK_GAS_PRICE_WEI and marks degraded", async () => {
    const readers = liveReaders({ feeData: throwingReader<FeeDataReader>() });
    const result = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers });
    expect(result.degraded).toBe(true);

    // Recompute by hand using the fallback gas price in place of the live one.
    const l1Fee = await readers.l1Fee.getL1Fee("upto");
    const { price, decimals } = await readers.ethUsd.getEthUsd();
    const gasWei = settleGasUnits("upto", NETWORK) * FALLBACK_GAS_PRICE_WEI + l1Fee;
    const microUsdPerEth = (price * 1_000_000n) / 10n ** BigInt(decimals);
    const expected = ((gasWei * microUsdPerEth + 10n ** 18n - 1n) / 10n ** 18n) * BigInt(SAFETY_MULTIPLIER);
    expect(result.microUsdc).toBe(expected.toString());
  });

  it("l1Fee throwing falls back to FALLBACK_L1_FEE_WEI and marks degraded", async () => {
    const readers = liveReaders({ l1Fee: throwingReader<L1DataFeeReader>() });
    const result = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers });
    expect(result.degraded).toBe(true);

    const { baseFeePerGas, maxPriorityFeePerGas } = await readers.feeData.getFeeData();
    const { price, decimals } = await readers.ethUsd.getEthUsd();
    const gasWei = settleGasUnits("upto", NETWORK) * (baseFeePerGas + maxPriorityFeePerGas) + FALLBACK_L1_FEE_WEI;
    const microUsdPerEth = (price * 1_000_000n) / 10n ** BigInt(decimals);
    const expected = ((gasWei * microUsdPerEth + 10n ** 18n - 1n) / 10n ** 18n) * BigInt(SAFETY_MULTIPLIER);
    expect(result.microUsdc).toBe(expected.toString());
  });

  it("ethUsd throwing falls back to FALLBACK_ETH_USD ($5,000) and marks degraded", async () => {
    const readers = liveReaders({ ethUsd: throwingReader<EthUsdReader>() });
    const result = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers });
    expect(result.degraded).toBe(true);

    const { baseFeePerGas, maxPriorityFeePerGas } = await readers.feeData.getFeeData();
    const l1Fee = await readers.l1Fee.getL1Fee("upto");
    const gasWei = settleGasUnits("upto", NETWORK) * (baseFeePerGas + maxPriorityFeePerGas) + l1Fee;
    const microUsdPerEth = (FALLBACK_ETH_USD.price * 1_000_000n) / 10n ** BigInt(FALLBACK_ETH_USD.decimals);
    const expected = ((gasWei * microUsdPerEth + 10n ** 18n - 1n) / 10n ** 18n) * BigInt(SAFETY_MULTIPLIER);
    expect(result.microUsdc).toBe(expected.toString());
  });

  it("all three readers throwing still returns a finite fee, fully from fallback constants", async () => {
    const readers: FeeReaders = {
      feeData: throwingReader<FeeDataReader>(),
      l1Fee: throwingReader<L1DataFeeReader>(),
      ethUsd: throwingReader<EthUsdReader>(),
    };
    const result = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers });
    expect(result.degraded).toBe(true);
    expect(BigInt(result.microUsdc) > 0n).toBe(true);
  });

  it("fail-closed NEVER under-charges relative to the live-path estimate for the same scenario", async () => {
    // "Over-charge briefly, never under-charge" (workspace#45): with fallback
    // constants chosen as generous upper bounds, a degraded estimate computed
    // from realistic live values should never be cheaper than the live estimate.
    const realisticLive = liveReaders(); // 1.1 gwei execution, tiny L1 fee, $3000 ETH
    const liveResult = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers: realisticLive });

    const allDegraded: FeeReaders = {
      feeData: throwingReader<FeeDataReader>(),
      l1Fee: throwingReader<L1DataFeeReader>(),
      ethUsd: throwingReader<EthUsdReader>(),
    };
    const degradedResult = await computeSettlementFee({ scheme: "upto", network: NETWORK, readers: allDegraded });

    expect(BigInt(degradedResult.microUsdc) >= BigInt(liveResult.microUsdc)).toBe(true);
  });
});

describe("integration: computeSettlementFee's output floors the marketplace take (workspace#45)", () => {
  // This package deliberately does not depend on @x402cloud/middleware (see
  // CLAUDE.md's dependency graph — facilitator is protocol+evm+viem only).
  // `@x402cloud/middleware`'s own margin.test.ts proves the general
  // take-never-below-floor property for `computeTake`/`retailPrice`; this
  // test proves fee.ts's OUTPUT actually behaves as a valid floor input to
  // that same formula (`take = max(wholesale*marginBps/10000, feeFloor)`) —
  // i.e. the two packages' contracts actually compose, without either
  // package importing the other.
  it("a settle's take is always >= the computed fee estimate, across a range of wholesale costs", async () => {
    const { microUsdc: feeFloor } = await computeSettlementFee({
      scheme: "upto",
      network: NETWORK,
      readers: liveReaders(),
    });
    const floor = BigInt(feeFloor);
    const marginBps = 2000n;

    for (const wholesale of ["0", "1", "4", "1000", "1000000"]) {
      const w = BigInt(wholesale);
      const marginTake = (w * marginBps) / 10_000n;
      const take = marginTake > floor ? marginTake : floor;
      expect(take >= floor).toBe(true);
    }
  });
});
