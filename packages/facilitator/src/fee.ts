import type { Network, Scheme } from "@x402cloud/protocol";

/**
 * Computed settlement-fee floor (workspace#45).
 *
 * Every settled call fires one on-chain `settle()` paid by the facilitator
 * wallet. A pure percentage of a micro-amount cannot cover the fixed gas cost
 * of its own settlement, so the marketplace's take is a percentage FLOORED by
 * a gas-cost estimate — see `@x402cloud/middleware`'s `computeTake` for where
 * that floor is applied. This module owns computing the floor itself, in
 * micro-USDC, from live chain data:
 *
 *   gasWei        = SETTLE_GAS_UNITS[scheme:network] × (baseFee + priorityFee)
 *                     + l1DataFee
 *   settlementFee = ceil( gasWei × ethUsdMicroPerEth / 1e18 ) × SAFETY_MULTIPLIER
 *
 * Every live input is a PORT (data over mechanism, same shape as
 * `FacilitatorSigner` in `@x402cloud/evm`) so this module never touches viem
 * directly and its tests never mock viem internals — only these three small
 * interfaces. `./fee-readers.ts` implements them for real chains.
 *
 * Fail-closed (per-reader): if a live read throws, that ONE input falls back
 * to a conservative, reviewed UPPER-BOUND constant — never the computed fee
 * itself — so the result can only ever be an over-estimate, never an
 * under-estimate, and `degraded: true` says so on the result.
 */

/** micro-USDC decimal-string fee estimate + whether it used the fallback path. */
export type FeeEstimate = {
  /** USDC smallest units (6 decimals), as a decimal string. */
  microUsdc: string;
  /**
   * True when ANY of the three live reads failed and this estimate used a
   * fallback constant for that input. Surface this (a response header, a log
   * field — see `routes.ts`'s `/fee`) rather than only computing it, per
   * workspace#45's "surface the degraded state" requirement. Never silently
   * absorbed into a plain number.
   */
  degraded: boolean;
};

/**
 * Live base fee + suggested priority fee (wei) for the settlement chain.
 * The facilitator already calls the equivalent of this once per settle via
 * `prepareTransactionRequest` — this port lets fee estimation reuse that same
 * knowledge ahead of settling, at verify/quote time.
 */
export type FeeDataReader = {
  getFeeData(): Promise<{ baseFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
};

/**
 * Base's (OP-stack) L1 data-fee component (wei) for one settlement tx of the
 * given scheme. Often the dominant term on an L2 — the calldata itself is
 * charged for at L1 gas prices, independent of L2 execution gas.
 */
export type L1DataFeeReader = {
  getL1Fee(scheme: Scheme): Promise<bigint>;
};

/** Latest ETH/USD price, in the feed's own native scale (Chainlink: 8 decimals). */
export type EthUsdReader = {
  getEthUsd(): Promise<{ price: bigint; decimals: number }>;
};

export type FeeReaders = {
  feeData: FeeDataReader;
  l1Fee: L1DataFeeReader;
  ethUsd: EthUsdReader;
};

/**
 * Gas UNITS (not gas price, not USD) per settlement code path — the one input
 * in this model that is a measured physical fact about the deployed contracts
 * rather than a live market read. Keyed by `${scheme}:${network}`.
 *
 * STATUS (2026-08-14): these are engineering estimates for Permit2's
 * `permitWitnessTransferFrom` plus the x402 upto/exact proxy wrapper — NOT
 * yet re-measured from a real settle receipt in this environment (no
 * Foundry/anvil available at authoring time; see PR notes). They are
 * deliberately NOT a per-call fee constant — they are one factor in a formula
 * that also reads live gas price and live ETH/USD, so a stale value here
 * still tracks the market, it just has the wrong constant of proportionality
 * until corrected. `tests/e2e/gas-measurement.test.ts` re-measures the real
 * gasUsed on an Anvil fork and MUST be run (and this table corrected, if it
 * drifts) before these numbers back a mainnet fee floor.
 */
export const SETTLE_GAS_UNITS: Readonly<Record<string, bigint>> = Object.freeze({
  "upto:eip155:8453": 180_000n,
  "upto:eip155:84532": 180_000n,
  "exact:eip155:8453": 160_000n,
  "exact:eip155:84532": 160_000n,
});

/**
 * Approximate calldata size (bytes) for one settlement tx of the given
 * scheme — feeds the L1 data-fee read. Same measurement status as
 * `SETTLE_GAS_UNITS` above: an estimate pending real-trace confirmation.
 */
export const SETTLE_CALLDATA_BYTES: Readonly<Record<Scheme, number>> = Object.freeze({
  upto: 320,
  exact: 260,
});

function gasUnitsKey(scheme: Scheme, network: Network): string {
  return `${scheme}:${network}`;
}

/** Measured (see status note above) gas units for one settle of this scheme+network. */
export function settleGasUnits(scheme: Scheme, network: Network): bigint {
  const units = SETTLE_GAS_UNITS[gasUnitsKey(scheme, network)];
  if (units === undefined) {
    throw new Error(
      `No measured SETTLE_GAS_UNITS for scheme "${scheme}" on network "${network}" — ` +
        `add a measured entry before pricing settlement on this network.`,
    );
  }
  return units;
}

/**
 * Safety multiplier over the raw computed gas cost — covers quote→settle
 * drift (the fee is read once, but the settle it floors may fire seconds
 * later) and short fee spikes. A reviewed config value with a documented
 * rationale, UNLIKE the fee itself (workspace#45 is explicit that the fee
 * must be computed, not this multiplier — this is policy, not a cost fact).
 */
export const SAFETY_MULTIPLIER = 2;

/**
 * Fail-closed fallback constants — used ONLY when a live read throws. Each is
 * a documented, reviewed UPPER BOUND: guaranteed to over-charge a degraded
 * quote rather than under-charge it. These are not "the fee" — they are what
 * "the fee" falls back to when we cannot compute it. Revisit if Base's real
 * base fee or ETH's price sustains a level near one of these for a long
 * period (a persistently-degraded facilitator should be fixed, not have its
 * ceiling raised).
 */
export const FALLBACK_GAS_PRICE_WEI = 50_000_000_000n; // 50 gwei execution gas price
export const FALLBACK_L1_FEE_WEI = 2_000_000_000_000n; // 0.000002 ETH — generous L1 data-fee spike
export const FALLBACK_ETH_USD = { price: 5000_00000000n, decimals: 8 }; // $5,000/ETH

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** ETH/USD price scaled to micro-USD (1e6) per 1 ETH (1e18 wei). */
function ethUsdMicroPerEth(price: bigint, decimals: number): bigint {
  const scale = 10n ** BigInt(decimals);
  return (price * 1_000_000n) / scale;
}

export type ComputeSettlementFeeInputs = {
  scheme: Scheme;
  network: Network;
  readers: FeeReaders;
  /** Overrides `SAFETY_MULTIPLIER` — pass only with a reviewed reason. */
  safetyMultiplier?: number;
};

/**
 * The computed settlement-fee floor for one scheme+network, in micro-USDC.
 * Fails closed per-reader — see the module doc for the fallback contract.
 */
export async function computeSettlementFee(inputs: ComputeSettlementFeeInputs): Promise<FeeEstimate> {
  const gasUnits = settleGasUnits(inputs.scheme, inputs.network);
  const safety = BigInt(inputs.safetyMultiplier ?? SAFETY_MULTIPLIER);
  if (safety <= 0n) throw new Error("safetyMultiplier must be positive");

  let degraded = false;

  let executionGasPriceWei: bigint;
  try {
    const { baseFeePerGas, maxPriorityFeePerGas } = await inputs.readers.feeData.getFeeData();
    executionGasPriceWei = baseFeePerGas + maxPriorityFeePerGas;
  } catch {
    degraded = true;
    executionGasPriceWei = FALLBACK_GAS_PRICE_WEI;
  }

  let l1FeeWei: bigint;
  try {
    l1FeeWei = await inputs.readers.l1Fee.getL1Fee(inputs.scheme);
  } catch {
    degraded = true;
    l1FeeWei = FALLBACK_L1_FEE_WEI;
  }

  let ethUsd: { price: bigint; decimals: number };
  try {
    ethUsd = await inputs.readers.ethUsd.getEthUsd();
  } catch {
    degraded = true;
    ethUsd = FALLBACK_ETH_USD;
  }

  const gasWei = gasUnits * executionGasPriceWei + l1FeeWei;
  const microUsdPerEth = ethUsdMicroPerEth(ethUsd.price, ethUsd.decimals);
  const microUsdc = ceilDiv(gasWei * microUsdPerEth, 10n ** 18n) * safety;

  return { microUsdc: microUsdc.toString(), degraded };
}
