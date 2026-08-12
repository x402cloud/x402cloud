import type { Network } from "@x402cloud/protocol";
import { CASPER_NETWORKS, MOTES_DECIMALS, MOTES_PER_CSPR } from "./constants.js";

/** Narrow a CAIP-2 network to one this package services. */
export function isCasperNetwork(network: string): network is Network {
  return (CASPER_NETWORKS as readonly string[]).includes(network);
}

/**
 * Assert that `network` is a Casper CAIP-2 network. Mirrors the EVM package's
 * `parseChainId` guard: wrong-family input is a hard error, never a silent
 * fallback.
 */
export function assertCasperNetwork(network: Network): Network {
  if (!isCasperNetwork(network)) {
    throw new Error(
      `${network} is not a Casper network. Use @x402cloud/casper only for casper:* networks.`,
    );
  }
  return network;
}

/**
 * Cap on accepted Unix timestamps. `9999999999` ≈ year 2286 — comfortably past
 * any plausible legitimate deadline and well below `Number.MAX_SAFE_INTEGER`.
 * Anything larger is treated as garbage (or an attempt to bypass a
 * `deadline < now` check via `parseInt("999...") === Infinity`).
 */
export const MAX_UNIX_SECONDS = 9_999_999_999n;

/**
 * Parse a string holding a non-negative Unix-seconds timestamp into a BigInt.
 * Returns `null` for any input that is empty, non-numeric, negative, or past
 * `MAX_UNIX_SECONDS`. Callers MUST treat `null` as a hard failure — never
 * silently coerce.
 */
export function parseUnixSeconds(value: string): bigint | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^\d+$/.test(value)) return null;
  let n: bigint;
  try {
    n = BigInt(value);
  } catch {
    return null;
  }
  if (n < 0n || n > MAX_UNIX_SECONDS) return null;
  return n;
}

/**
 * Parse an integer mote amount into a BigInt. Motes are the smallest wCSPR
 * unit, so the wire format is always a plain non-negative decimal integer —
 * decimals, exponents, and signs are rejected outright.
 */
export function parseMotes(value: string): bigint | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Convert a decimal CSPR string (e.g. "1.25") to motes.
 *
 * THROWS on sub-mote precision rather than truncating. Silently dropping the
 * tenth decimal would under-charge the payer and desynchronise the amount from
 * the signed authorization, so any input finer than 1e-9 CSPR is a hard error.
 */
export function csprToMotes(value: string): bigint {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("csprToMotes: amount must be a non-empty string");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`csprToMotes: "${value}" is not a non-negative decimal amount`);
  }
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > MOTES_DECIMALS) {
    throw new Error(
      `csprToMotes: "${value}" has more than ${MOTES_DECIMALS} decimals — sub-mote precision would be lost`,
    );
  }
  const padded = fraction.padEnd(MOTES_DECIMALS, "0");
  return BigInt(whole) * MOTES_PER_CSPR + BigInt(padded === "" ? "0" : padded);
}

/**
 * Format an integer mote amount as a decimal CSPR string. Exact by
 * construction — motes are integers and 1e9 divides evenly, so no rounding
 * ever occurs. Trailing zeros in the fraction are trimmed.
 */
export function formatMotes(motes: bigint): string {
  if (typeof motes !== "bigint") {
    throw new Error("formatMotes: amount must be a bigint");
  }
  const negative = motes < 0n;
  const abs = negative ? -motes : motes;
  const whole = abs / MOTES_PER_CSPR;
  const fraction = (abs % MOTES_PER_CSPR).toString().padStart(MOTES_DECIMALS, "0").replace(/0+$/, "");
  const body = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${body}` : body;
}
