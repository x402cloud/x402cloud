import type { Target } from "../types.js";

export type AddressLookup =
  | { ok: true; address: string }
  | { ok: false; error: string };

/**
 * Resolves the facilitator's on-chain settlement address: the target's
 * explicit override if set, otherwise fetched live from the facilitator's
 * own `/supported` endpoint. Shared by every probe that needs "the
 * facilitator's wallet address" (gas balance, USDC balance) so the lookup
 * has exactly one definition instead of a copy per probe.
 */
export async function resolveFacilitatorAddress(
  target: Target,
  signal: AbortSignal,
): Promise<AddressLookup> {
  if (target.facilitatorAddress) {
    return { ok: true, address: target.facilitatorAddress };
  }

  if (!target.facilitator) {
    return { ok: false, error: "Target has no facilitator URL configured" };
  }

  const response = await fetch(`${target.facilitator}/supported`, { signal });

  if (!response.ok) {
    return { ok: false, error: `Could not fetch facilitator address: ${response.status}` };
  }

  const supported = (await response.json()) as {
    address?: string;
    facilitator?: string;
  };
  const address = supported.facilitator ?? supported.address;

  if (!address) {
    return { ok: false, error: "Facilitator did not return an address" };
  }

  return { ok: true, address };
}
