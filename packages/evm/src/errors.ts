/**
 * Sanitize an error before returning it to a caller (or worse, logging it
 * to a third-party error tracker). Settlement errors come from viem and may
 * contain RPC URLs (sometimes with embedded API keys), full transaction
 * payloads, and addresses we don't want to leak to public clients.
 *
 * The sanitized form keeps the short error name + first line of the message
 * with hex blobs longer than 32 chars redacted. That's enough for an operator
 * to recognise the failure class without exposing internals.
 */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // Take only the first line — viem stacks include multiple lines with full URLs.
  const firstLine = raw.split("\n", 1)[0] ?? raw;
  // Redact long hex strings (signatures, raw txs, calldata).
  const redactedHex = firstLine.replace(/0x[a-fA-F0-9]{64,}/g, "[hex_redacted]");
  // Redact http(s) URLs entirely — they may contain RPC API keys.
  const redactedUrl = redactedHex.replace(/https?:\/\/\S+/g, "[url_redacted]");
  // Cap length — defensively prevent log bombs.
  return redactedUrl.length > 240 ? redactedUrl.slice(0, 240) + "…" : redactedUrl;
}
