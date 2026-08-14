/**
 * Margin helper for the marketplace merchant-of-record model.
 *
 * Each tradable service computes its wholesale cost (what the upstream provider
 * charges us) then applies a marketplace margin before settling on-chain. The
 * agent pays the retail amount; the spread is the platform take.
 *
 * Inputs and outputs are USDC smallest units (6 decimals) as decimal strings,
 * to match the `MeterFunction` contract from `@x402cloud/protocol`.
 *
 * ── Unit economics floor (workspace#45) ─────────────────────────────────
 *
 * Every settled call fires one on-chain `settle()` paid by the facilitator
 * wallet. A pure percentage of a micro-amount cannot cover the fixed gas cost
 * of its own settlement, so the take is a percentage FLOORED by a gas-cost
 * estimate, never a flat per-call fee:
 *
 *   take   = max( wholesale × marginBps/10000, feeFloor )
 *   retail = clampToAuthorized( wholesale + take, authorized )
 *
 * `feeFloor` is computed elsewhere (`@x402cloud/facilitator`'s
 * `computeSettlementFee` — measured gas units × live network fees × live
 * ETH/USD, with a fail-closed upper-bound fallback) and handed in here as
 * data. This module stays pure and margin-only; it never computes gas costs
 * itself — that would braid "how much does a settle cost right now" into
 * "what's our take rate", two concerns that must be free to change
 * independently (Hickey: decouple policy from mechanism).
 *
 * `feeFloor` defaults to `"0"` — every existing caller (and the testnet
 * deployment, where settlement is free) is unaffected until it opts in by
 * passing a real value.
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
 * The marketplace's take on a wholesale cost: percentage of wholesale, or
 * `feeFloor`, whichever is larger. This is the one place the floor semantics
 * live — both `retailPrice` (settle-time) and manifest maxPrice derivations
 * (quote-time) should compose through this rather than re-deriving the rule.
 *
 * @param wholesale USDC smallest units (6 decimals) as a decimal string
 * @param marginBps Basis points
 * @param feeFloor  Computed settlement-fee floor, USDC smallest units as a
 *                  decimal string. Defaults to "0" (no floor — testnet).
 */
export function computeTake(
  wholesale: string,
  marginBps = DEFAULT_MARGIN_BPS,
  feeFloor = "0",
): string {
  if (marginBps < 0) throw new Error("marginBps must be non-negative");
  const floor = BigInt(feeFloor);
  if (floor < 0n) throw new Error("feeFloor must be non-negative");
  const w = BigInt(wholesale);
  const marginTake = (w * BigInt(marginBps)) / 10_000n;
  return (marginTake > floor ? marginTake : floor).toString();
}

/**
 * Compose: wholesale → take (margin, floored by fee) → clamp. The full
 * retail-pricing pipeline every marketplace service should run inside its
 * meter.
 *
 * Big calls price at pure percentage margin (the fee is absorbed, so the
 * headline rate stays competitive); micro calls price at `feeFloor` (never
 * below the cost of settling them) — see the module doc for the model.
 */
export function retailPrice(
  wholesale: string,
  authorized: string,
  marginBps = DEFAULT_MARGIN_BPS,
  feeFloor = "0",
): string {
  const retail = (BigInt(wholesale) + BigInt(computeTake(wholesale, marginBps, feeFloor))).toString();
  return clampToAuthorized(retail, authorized);
}
