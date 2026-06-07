/**
 * Wholesale pricing for the sandbox service.
 *
 * Cloudflare Sandbox SDK does not publish a public per-second price; we
 * pick a defensible wholesale anchor covering the `lite` container instance:
 *
 *   WHOLESALE_PER_SECOND_USD = $0.0005 / sec
 *
 * Markup lives in the meter via `retailPrice`. This file is wholesale-only.
 */

/** Default wholesale rate, USD per sandbox-second. */
export const WHOLESALE_PER_SECOND_USD = 0.0005;

/** Hard cap on a single sandbox invocation (ms). */
export const MAX_DURATION_MS = 30_000;

/**
 * Wholesale cost in USDC smallest units (6 decimals) for a given duration.
 *
 * Pure: input ms → output decimal-string micro-USDC. No globals, no markup.
 * Negative or non-finite input is treated as zero. Anything above
 * `MAX_DURATION_MS` is clamped to MAX_DURATION_MS.
 */
export function wholesaleForDurationMs(
  durationMs: number,
  ratePerSecondUsd: number = WHOLESALE_PER_SECOND_USD,
): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0";
  const capped = durationMs > MAX_DURATION_MS ? MAX_DURATION_MS : durationMs;
  const seconds = capped / 1000;
  const usd = seconds * ratePerSecondUsd;
  return Math.round(usd * 1_000_000).toString();
}

/** Wholesale cost for the maximum permitted duration. */
export function maxWholesaleCost(
  ratePerSecondUsd: number = WHOLESALE_PER_SECOND_USD,
): string {
  return wholesaleForDurationMs(MAX_DURATION_MS, ratePerSecondUsd);
}
