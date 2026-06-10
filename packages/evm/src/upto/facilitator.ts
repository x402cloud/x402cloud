import type { PaymentRequirements } from "@x402cloud/protocol";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read the settlement facilitator address advertised in
 * `PaymentRequirements.extra.facilitator` (upto scheme).
 *
 * The canonical x402UptoPermit2Proxy witness binds the one address allowed to
 * call `settle` (`msg.sender == witness.facilitator`), so the client must know
 * it at signing time — the server advertises it in the 402 response.
 *
 * Returns `null` when missing or not address-shaped — callers fail closed.
 */
export function facilitatorFromRequirements(
  requirements: PaymentRequirements,
): `0x${string}` | null {
  const value = requirements.extra?.facilitator;
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) return null;
  return value as `0x${string}`;
}
