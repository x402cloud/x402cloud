import type { Scheme } from "@x402cloud/protocol";
import type { FeeEstimate } from "./fee.js";

/**
 * Short-TTL memoization for `computeSettlementFee`, keyed by scheme.
 *
 * `estimateFee` rides on every `/verify` call, and the live reads it composes
 * (RPC fee data, an L1-oracle read, a Chainlink read) are each a network
 * round trip — worth amortising across a burst of requests. workspace#45
 * asks for exactly this on the ETH/USD leg ("cached with a short TTL, ~60s");
 * caching the whole composed estimate is a superset that also amortises the
 * other two reads, with no extra staleness risk (the TTL still bounds how
 * old the number can be).
 *
 * Pure wrapper: takes the compute function and a clock as data, returns a
 * function with the same shape plus memoization. No hidden global cache.
 */
export function cachedFeeEstimator(
  compute: (scheme: Scheme) => Promise<FeeEstimate>,
  ttlMs = 60_000,
  now: () => number = Date.now,
): (scheme: Scheme) => Promise<FeeEstimate> {
  const cache = new Map<Scheme, { estimate: FeeEstimate; expiresAt: number }>();

  return async (scheme: Scheme): Promise<FeeEstimate> => {
    const cached = cache.get(scheme);
    if (cached && cached.expiresAt > now()) {
      return cached.estimate;
    }
    const estimate = await compute(scheme);
    cache.set(scheme, { estimate, expiresAt: now() + ttlMs });
    return estimate;
  };
}
