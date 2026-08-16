import type { CasperExactPayload } from "./types.js";
import { parseMotes, parseUnixSeconds } from "./utils.js";
import { isCasperNetwork } from "./utils.js";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Runtime validation of a decoded Casper `exact` payload.
 *
 * Runs at the decode boundary, before anything is forwarded to the
 * facilitator: a payload that cannot be structurally trusted must never
 * consume a network round-trip. Returns `null` on any violation — callers
 * treat `null` as a hard failure (fail closed), never as "probably fine".
 */
export function parseCasperExactPayload(value: unknown): CasperExactPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const root = value as Record<string, unknown>;

  if (!isNonEmptyString(root.signature)) return null;

  const auth = root.authorization;
  if (typeof auth !== "object" || auth === null) return null;
  const a = auth as Record<string, unknown>;

  if (!isNonEmptyString(a.from)) return null;
  if (!isNonEmptyString(a.to)) return null;
  if (!isNonEmptyString(a.asset)) return null;
  if (!isNonEmptyString(a.nonce)) return null;
  if (!isNonEmptyString(a.network) || !isCasperNetwork(a.network)) return null;

  if (!isNonEmptyString(a.value)) return null;
  const motes = parseMotes(a.value);
  if (motes === null || motes <= 0n) return null;

  if (!isNonEmptyString(a.deadline)) return null;
  const deadline = parseUnixSeconds(a.deadline);
  if (deadline === null) return null;

  if (!isNonEmptyString(a.validAfter)) return null;
  const validAfter = parseUnixSeconds(a.validAfter);
  if (validAfter === null) return null;

  if (validAfter >= deadline) return null;

  return {
    signature: root.signature,
    authorization: {
      from: a.from,
      to: a.to,
      value: a.value,
      asset: a.asset,
      network: a.network,
      nonce: a.nonce,
      deadline: a.deadline,
      validAfter: a.validAfter,
    },
  };
}
