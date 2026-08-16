import { applyMargin, DEFAULT_MARGIN_BPS } from "@x402cloud/protocol";

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
 * Apply the marketplace margin to a wholesale micro-USDC amount and render
 * as a display string. The retail value here is what is shown to the agent
 * as the `maxPrice` ceiling — the actual settle still flows through the
 * meter and clamps to authorizedAmount.
 */
export function retailDisplay(
  wholesaleMicro: string,
  marginBps: number = DEFAULT_MARGIN_BPS,
): string {
  return microToUsdDisplay(applyMargin(wholesaleMicro, marginBps));
}
