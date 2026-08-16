/**
 * Margin helper for the marketplace merchant-of-record model.
 *
 * Each tradable service computes its wholesale cost (what the upstream provider
 * charges us) then applies a marketplace margin before settling on-chain. The
 * agent pays the retail amount; the spread is the platform take.
 *
 * Inputs and outputs are USDC smallest units (6 decimals) as decimal strings,
 * to match the `MeterFunction` contract in this package.
 */

/** Default marketplace take rate, in basis points (2000 = 20%) */
export const DEFAULT_MARGIN_BPS = 2000;

/**
 * Apply a margin (in basis points) to a wholesale cost.
 *
 *   applyMargin("1000000", 2000)  -> "1200000"  (20% markup on 1 USDC)
 *
 * @param wholesale USDC smallest units (6 decimals) as a decimal string
 * @param marginBps Basis points (100 = 1%, 2000 = 20%, 10000 = 100%)
 */
export function applyMargin(wholesale: string, marginBps = DEFAULT_MARGIN_BPS): string {
  if (marginBps < 0) throw new Error("marginBps must be non-negative");
  const w = BigInt(wholesale);
  return ((w * BigInt(10_000 + marginBps)) / 10_000n).toString();
}

/**
 * Clamp a cost to the agent's authorized maximum. The on-chain contract enforces
 * this too, but clamping early avoids surfacing settle reverts to the user.
 */
export function clampToAuthorized(cost: string, authorized: string): string {
  return BigInt(cost) > BigInt(authorized) ? authorized : cost;
}

/**
 * Compose: wholesale → margin → clamp. The full retail-pricing pipeline
 * every marketplace service should run inside its meter.
 */
export function retailPrice(
  wholesale: string,
  authorized: string,
  marginBps = DEFAULT_MARGIN_BPS,
): string {
  return clampToAuthorized(applyMargin(wholesale, marginBps), authorized);
}
