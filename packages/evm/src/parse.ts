import type { Permit2Authorization, UptoPayload, ExactPayload } from "./types.js";

/**
 * Validate that a value is a hex string (0x-prefixed).
 * Checks prefix only — does not validate hex character content.
 */
function assertHexString(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error(`${field}: expected hex string (0x...), got ${typeof value === "string" ? JSON.stringify(value) : typeof value}`);
  }
}

/**
 * Validate that a value is a string (for numeric fields serialized as strings like nonce, deadline, amount).
 */
function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${field}: expected string, got ${typeof value}`);
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

  assertHexString(raw.from, `${path}.from`);
  assertHexString(raw.spender, `${path}.spender`);
  assertString(raw.nonce, `${path}.nonce`);
  assertString(raw.deadline, `${path}.deadline`);

  // permitted
  assertObject(raw.permitted, `${path}.permitted`);
  assertHexString(raw.permitted.token, `${path}.permitted.token`);
  assertString(raw.permitted.amount, `${path}.permitted.amount`);

  // witness
  assertObject(raw.witness, `${path}.witness`);
  assertHexString(raw.witness.to, `${path}.witness.to`);
  assertString(raw.witness.validAfter, `${path}.witness.validAfter`);
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
