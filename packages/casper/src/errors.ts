/**
 * Sanitize an error before returning it to a caller (or worse, logging it to a
 * third-party error tracker). Facilitator errors may embed the facilitator URL
 * (potentially with a path token), deploy hashes, and full request bodies we
 * don't want to leak to public clients.
 *
 * The sanitized form keeps the short error name + first line of the message
 * with long hex blobs redacted — enough for an operator to recognise the
 * failure class without exposing internals.
 */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // Take only the first line — fetch/undici errors include multi-line causes.
  const firstLine = raw.split("\n", 1)[0] ?? raw;
  // Redact long hex strings (deploy hashes, signatures, account hashes).
  const redactedHex = firstLine.replace(/(0x)?[a-fA-F0-9]{64,}/g, "[hex_redacted]");
  // Redact http(s) URLs entirely — they may contain access tokens.
  const redactedUrl = redactedHex.replace(/https?:\/\/\S+/g, "[url_redacted]");
  // Cap length — defensively prevent log bombs.
  return redactedUrl.length > 240 ? redactedUrl.slice(0, 240) + "…" : redactedUrl;
}

/**
 * Canonical failure reasons returned by this package.
 *
 * Every one is a CLOSED outcome: an unreachable facilitator, a malformed
 * response, or a timeout all resolve to "not verified" / "not settled" rather
 * than an optimistic pass. Callers never have to guess whether an unknown
 * string meant success.
 */
export const CASPER_ERRORS = Object.freeze({
  /** `requirements.network` is not a Casper CAIP-2 network. */
  UNSUPPORTED_NETWORK: "unsupported_network",
  /** `requirements.scheme` is not "exact". */
  UNSUPPORTED_SCHEME: "unsupported_scheme",
  /** Payload failed structural validation before it ever left the process. */
  INVALID_PAYLOAD: "invalid_payload",
  /** The wCSPR contract for this network is not configured. */
  ASSET_NOT_CONFIGURED: "asset_not_configured",
  /** Payload asset/network does not match the requirements it is answering. */
  REQUIREMENTS_MISMATCH: "requirements_mismatch",
  /** Facilitator call exceeded the bounded timeout. */
  FACILITATOR_TIMEOUT: "facilitator_timeout",
  /** Transport-level failure reaching the facilitator (DNS, TLS, socket). */
  FACILITATOR_UNREACHABLE: "facilitator_unreachable",
  /** Facilitator answered with a non-2xx status. */
  FACILITATOR_ERROR: "facilitator_error",
  /** Facilitator answered 2xx with a body we cannot trust. */
  FACILITATOR_MALFORMED_RESPONSE: "facilitator_malformed_response",
} as const);

export type CasperErrorReason = (typeof CASPER_ERRORS)[keyof typeof CASPER_ERRORS];
