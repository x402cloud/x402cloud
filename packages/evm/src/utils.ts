import type { Network } from "@x402cloud/protocol";

/** Parse CAIP-2 network string to chain ID number */
export function parseChainId(network: Network): number {
  const parts = network.split(":");
  if (parts.length !== 2 || parts[0] !== "eip155") {
    throw new Error(`${network} is not an EVM network. Use @x402cloud/evm only for eip155:* networks.`);
  }
  const chainId = parseInt(parts[1], 10);
  if (isNaN(chainId)) {
    throw new Error(`Invalid chain ID in network: ${network}`);
  }
  return chainId;
}

/**
 * Cap on accepted Unix timestamps. `9999999999` ≈ year 2286 — comfortably
 * past any plausible legitimate deadline and well below `Number.MAX_SAFE_INTEGER`.
 * Anything larger is treated as garbage (or an attempt to bypass the
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
  // Reject anything that isn't a plain decimal integer — no signs, no
  // exponents, no whitespace.
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
