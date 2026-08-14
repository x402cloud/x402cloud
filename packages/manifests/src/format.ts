import { computeTake, DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";

/**
 * Convert micro-USDC (decimal string) to a 6-decimal USD display string
 * ($X.XXXXXX). Pads with leading zeros; no exponent notation.
 */
export function microToUsdDisplay(micro: string): string {
  const n = BigInt(micro);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const padded = abs.toString().padStart(7, "0");
  const whole = padded.slice(0, padded.length - 6);
  const frac = padded.slice(padded.length - 6);
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}

/**
 * Apply the marketplace margin (floored by a settlement-fee estimate — see
 * `@x402cloud/middleware`'s `computeTake`, workspace#45) to a wholesale
 * micro-USDC amount and render as a display string. The retail value here is
 * what is shown to the agent as the `maxPrice` ceiling — the actual settle
 * still flows through the meter and clamps to authorizedAmount, using its own
 * (fresher) fee reading at settle time. `feeFloorMicro` defaults to "0"
 * (testnet has no fee floor); a mainnet deployment passes the facilitator's
 * current fee quote so the 402 ceiling has headroom for it.
 */
export function retailDisplay(
  wholesaleMicro: string,
  marginBps: number = DEFAULT_MARGIN_BPS,
  feeFloorMicro = "0",
): string {
  const take = computeTake(wholesaleMicro, marginBps, feeFloorMicro);
  const retail = (BigInt(wholesaleMicro) + BigInt(take)).toString();
  return microToUsdDisplay(retail);
}
