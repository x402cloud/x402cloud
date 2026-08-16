import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "./types.js";

/**
 * The wire shape of a price: canonical `amount` plus the legacy `maxAmount`
 * mirror, always the same value.
 *
 * This is the ONLY place the second spelling is produced. In memory there is
 * one price field (`PaymentRequirements.amount`); `maxAmount` exists so clients
 * pinned to this implementation's original name — and the offers they already
 * know how to read — keep working. Delete this function and its two call sites
 * to retire the mirror; see DESIGN.md § The price field for the dated plan.
 */
export function toWireRequirements(
  requirements: PaymentRequirements,
): PaymentRequirements & { maxAmount: string } {
  return { ...requirements, maxAmount: requirements.amount };
}

/** Apply the wire mirror to every offer in a 402 envelope. */
export function toWirePaymentRequired(required: PaymentRequired): PaymentRequired {
  return { ...required, accepts: required.accepts.map(toWireRequirements) };
}

/** Encode payment payload to base64 header value */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return btoa(
    JSON.stringify({ ...payload, accepted: toWireRequirements(payload.accepted) }),
  );
}

/** Decode payment payload from header value */
export function decodePaymentHeader(header: string): PaymentPayload {
  return JSON.parse(atob(header));
}

/** Encode 402 requirements to base64 header value */
export function encodeRequirementsHeader(required: PaymentRequired): string {
  return btoa(JSON.stringify(toWirePaymentRequired(required)));
}

/** Decode 402 requirements from header value */
export function decodeRequirementsHeader(header: string): PaymentRequired {
  return JSON.parse(atob(header));
}

/** Extract payment header from request (supports v1 + v2 header names) */
export function extractPaymentHeader(request: Request): string | null {
  return (
    request.headers.get("PAYMENT-SIGNATURE") ??
    request.headers.get("X-PAYMENT") ??
    null
  );
}

/** Parse USDC amount string to smallest units (6 decimals) */
export function parseUsdcAmount(price: string): string {
  const cleaned = price.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Invalid USDC amount: "${price}"`);

  const [intPart, fracPart = ""] = cleaned.split(".");
  // Pad or truncate fractional part to exactly 6 digits
  const padded = fracPart.padEnd(6, "0").slice(0, 6);
  // Combine and strip leading zeros (but keep at least "0")
  const raw = intPart + padded;
  const result = raw.replace(/^0+/, "") || "0";
  return result;
}

/** Format USDC smallest units to human-readable string */
export function formatUsdcAmount(units: string): string {
  return `$${(Number(BigInt(units)) / 1e6).toFixed(6)}`;
}
