import type { SettleResponse } from "@x402cloud/protocol";

/**
 * Pure classification of settlement failures into DEFINITIVE vs TRANSIENT.
 *
 * On-chain settlement is not durable: an RPC hiccup or a dropped network
 * connection can fail a perfectly valid settlement. Retrying those is safe and
 * desirable. But some failures are the contract (or the payload) telling us
 * "no" — retrying those only wastes gas and confuses operators. This is the one
 * place that decides which is which.
 *
 * The classification is data, not behaviour: it reads only the SettleResponse
 * value and returns a boolean. Callers (the worker's /settle handler) decide
 * what to *do* with that answer — enqueue a retry vs. surface the failure.
 *
 * DEFINITIVE (never retry — the answer will not change):
 *   - tampered_payload                  signature does not match the payload
 *   - signature_check_failed            signature verification threw
 *   - settlement_exceeds_authorization  amount > what the payer signed
 *   - transaction_reverted: <hash>      the chain rejected it (e.g. nonce used)
 *
 * TRANSIENT (retry — a later attempt may succeed):
 *   - settlement_failed: <message>      writeContract/RPC threw (network, RPC,
 *                                       timeout, nonce-too-low at the node, …)
 *   - any unrecognised errorReason      fail open to retry rather than silently
 *                                       drop money that might still be settled
 *
 * A successful SettleResponse is never transient — there is nothing to retry.
 */

/** errorReason prefix that means "tx broadcast, receipt unknown — CONFIRM, never re-broadcast". */
const PENDING_RECEIPT = "settlement_pending_receipt";

/** errorReason prefixes/values that must NOT be retried. */
const DEFINITIVE_FAILURES = [
  "tampered_payload",
  "signature_check_failed",
  "settlement_exceeds_authorization",
  "transaction_reverted",
] as const;

/** True if `reason` equals `token` or starts with `token:`. */
function matchesToken(reason: string, token: string): boolean {
  return reason === token || reason.startsWith(`${token}:`);
}

/**
 * True if a failed SettleResponse should be RE-BROADCAST later.
 *
 * Returns false for successes (nothing to retry), for definitive failures, AND
 * for settlement_pending_receipt — that last one already has a broadcast tx and
 * must be CONFIRMED, never re-broadcast (re-broadcasting double-spends the
 * single-use Permit2 nonce and reverts, losing the original revenue). Use
 * classifySettlement() to distinguish re-broadcast from confirm.
 */
export function isTransientFailure(result: SettleResponse): boolean {
  if (result.success) return false;

  const reason = result.errorReason ?? "";
  if (matchesToken(reason, PENDING_RECEIPT)) return false;
  for (const definitive of DEFINITIVE_FAILURES) {
    if (matchesToken(reason, definitive)) return false;
  }
  return true;
}

/**
 * Three-way classification of a SettleResponse — the single place that decides
 * what the durable orchestrator should DO with an outcome:
 *
 *   - "definitive"      success OR a failure that will not change (tampered,
 *                       signature, exceeds_authorization, transaction_reverted).
 *                       Record it terminally; do not retry. NOTE a successful
 *                       settle is "definitive" too — there is nothing to retry.
 *   - "retry_confirm"   settlement_pending_receipt:<hash> — a tx WAS broadcast
 *                       but the receipt is unknown. CONFIRM the known txHash;
 *                       NEVER re-broadcast (invariant I1).
 *   - "retry_broadcast" settlement_failed / unrecognised — no tx exists (or the
 *                       broadcast itself threw). Safe to re-broadcast.
 *
 * This is data, not behaviour: it reads only the SettleResponse and returns a
 * tag. Callers decide what to do with it.
 */
export type SettlementClass = "definitive" | "retry_confirm" | "retry_broadcast";

export function classifySettlement(result: SettleResponse): SettlementClass {
  if (result.success) return "definitive";

  const reason = result.errorReason ?? "";
  // A pending-receipt result only means "confirm the known tx" when it actually
  // CARRIES a parseable hash. The bare token "settlement_pending_receipt" (no
  // hash) has no tx to confirm — confirming "" would loop forever (cleanup:
  // empty-hash divergence). Classify it as retry_broadcast: there is no known
  // tx, so re-broadcasting is the only way forward. After Finding 1 every
  // post-send result carries a hash, so this is defensive.
  if (matchesToken(reason, PENDING_RECEIPT)) {
    return pendingReceiptTxHash(result) !== null ? "retry_confirm" : "retry_broadcast";
  }
  for (const definitive of DEFINITIVE_FAILURES) {
    if (matchesToken(reason, definitive)) return "definitive";
  }
  return "retry_broadcast";
}

/**
 * Extract the broadcast txHash from a settlement_pending_receipt result, or null
 * if the result is not a pending-receipt failure. The txHash is what the confirm
 * path needs to look up the real on-chain outcome.
 */
export function pendingReceiptTxHash(result: SettleResponse): string | null {
  if (result.success) return null;
  const reason = result.errorReason ?? "";
  if (!reason.startsWith(`${PENDING_RECEIPT}:`)) return null;
  const hash = reason.slice(`${PENDING_RECEIPT}:`.length).trim();
  return hash.length > 0 ? hash : null;
}
