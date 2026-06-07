import type { Permit2Authorization, UptoPayload, ExactPayload } from "./types.js";

/** Variable-length hex string: 0x followed by zero or more hex digits. */
const HEX_RE = /^0x[0-9a-fA-F]*$/;
/** Decimal uint256-style string: one or more digits, no sign, no point, no exponent. */
const DECIMAL_UINT_RE = /^[0-9]+$/;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value;
}

/**
 * Validate that a value is a hex string (0x-prefixed, hex digits only).
 *
 * Variable length — suitable for signatures and dynamic byte fields. For
 * fixed-width fields (e.g. addresses) use {@link assertAddress} or pass `bytes`.
 *
 * @param bytes Optional fixed byte length. When set, requires exactly
 *   `bytes * 2` hex digits after the prefix (e.g. 20 for an address).
 */
function assertHexString(
  value: unknown,
  field: string,
  bytes?: number
): asserts value is `0x${string}` {
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    throw new Error(`${field}: expected hex string (0x...), got ${describe(value)}`);
  }
  if (bytes !== undefined) {
    const digits = value.length - 2;
    if (digits !== bytes * 2) {
      throw new Error(`${field}: expected ${bytes}-byte hex (0x + ${bytes * 2} digits), got ${digits} hex digits`);
    }
  }
}

/** Validate that a value is a 20-byte (address-shaped) hex string. */
function assertAddress(value: unknown, field: string): asserts value is `0x${string}` {
  assertHexString(value, field, 20);
}

/**
 * Validate that a value is a decimal uint256-style string: digits only, no
 * sign, no decimal point, no exponent, non-empty. These guard fields that are
 * later passed to BigInt() (nonce, deadline, amount, validAfter) so malformed
 * input fails loudly at the boundary instead of deep in verification.
 */
function assertDecimalUint(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${field}: expected decimal integer string, got ${describe(value)}`);
  }
  if (!DECIMAL_UINT_RE.test(value)) {
    throw new Error(`${field}: expected decimal integer string (digits only), got ${JSON.stringify(value)}`);
  }
}

/**
 * Validate that a value is a non-null object.
 */
function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: expected object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`);
  }
}

/**
 * Validate and parse a Permit2Authorization from unknown data.
 */
function parsePermit2Authorization(raw: unknown, path: string): Permit2Authorization {
  assertObject(raw, path);

  assertAddress(raw.from, `${path}.from`);
  assertAddress(raw.spender, `${path}.spender`);
  assertDecimalUint(raw.nonce, `${path}.nonce`);
  assertDecimalUint(raw.deadline, `${path}.deadline`);

  // permitted
  assertObject(raw.permitted, `${path}.permitted`);
  assertAddress(raw.permitted.token, `${path}.permitted.token`);
  assertDecimalUint(raw.permitted.amount, `${path}.permitted.amount`);

  // witness
  assertObject(raw.witness, `${path}.witness`);
  assertAddress(raw.witness.to, `${path}.witness.to`);
  assertDecimalUint(raw.witness.validAfter, `${path}.witness.validAfter`);
  assertHexString(raw.witness.extra, `${path}.witness.extra`);

  return raw as unknown as Permit2Authorization;
}

/**
 * Parse and validate an UptoPayload from unknown decoded data.
 * Throws with a descriptive message if the structure is invalid.
 *
 * Checks structural shape only (fields exist, correct basic types).
 * Business-logic validation (amounts, deadlines, nonces) is done by verify.
 */
export function parseUptoPayload(raw: unknown): UptoPayload {
  assertObject(raw, "UptoPayload");
  assertHexString(raw.signature, "UptoPayload.signature");
  const permit2Authorization = parsePermit2Authorization(raw.permit2Authorization, "UptoPayload.permit2Authorization");
  return { signature: raw.signature as `0x${string}`, permit2Authorization };
}

/**
 * Parse and validate an ExactPayload from unknown decoded data.
 * Throws with a descriptive message if the structure is invalid.
 *
 * Checks structural shape only (fields exist, correct basic types).
 * Business-logic validation (amounts, deadlines, nonces) is done by verify.
 */
export function parseExactPayload(raw: unknown): ExactPayload {
  assertObject(raw, "ExactPayload");
  assertHexString(raw.signature, "ExactPayload.signature");
  const permit2Authorization = parsePermit2Authorization(raw.permit2Authorization, "ExactPayload.permit2Authorization");
  return { signature: raw.signature as `0x${string}`, permit2Authorization };
}
