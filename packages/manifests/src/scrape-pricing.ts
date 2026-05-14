/**
 * Wholesale pricing for the scrape service.
 *
 *   WHOLESALE_PER_REQUEST_USD = $0.001  (fixed per call)
 *   WHOLESALE_PER_SECOND_USD  = $0.0001 (per second of browser time)
 *
 * Markup lives in the meter via `retailPrice`. This file is wholesale-only.
 */

/** Default wholesale per-request fee, USD. */
export const WHOLESALE_PER_REQUEST_USD = 0.001;

/** Default wholesale rate, USD per browser-second. */
export const WHOLESALE_PER_SECOND_USD = 0.0001;

/** Hard cap on a single scrape invocation (ms). */
export const MAX_DURATION_MS = 30_000;

/**
 * Wholesale cost in USDC smallest units (6 decimals) for a given duration.
 */
export function wholesaleForDurationMs(
  durationMs: number,
  perRequestUsd: number = WHOLESALE_PER_REQUEST_USD,
  perSecondUsd: number = WHOLESALE_PER_SECOND_USD,
): string {
  const finite = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const capped = finite > MAX_DURATION_MS ? MAX_DURATION_MS : finite;
  const seconds = capped / 1000;
  const usd = perRequestUsd + seconds * perSecondUsd;
  return Math.round(usd * 1_000_000).toString();
}

/** Wholesale cost for the maximum permitted duration. Used as a fallback. */
export function maxWholesaleCost(
  perRequestUsd: number = WHOLESALE_PER_REQUEST_USD,
  perSecondUsd: number = WHOLESALE_PER_SECOND_USD,
): string {
  return wholesaleForDurationMs(MAX_DURATION_MS, perRequestUsd, perSecondUsd);
}
