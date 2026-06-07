import type { Network, SettleResponse } from "@x402cloud/protocol";
import type { FacilitatorSigner } from "./types.js";
import { SETTLEMENT_RECEIPT_TIMEOUT_MS } from "./constants.js";

/**
 * Confirm the on-chain outcome of an ALREADY-BROADCAST settlement transaction.
 *
 * This is the second half of settle: once a txHash exists the single-use Permit2
 * nonce may be consumed and USDC may have moved, so we must NEVER re-broadcast.
 * We can only look up the real on-chain receipt and report what actually
 * happened. `settle()` calls this once after a successful broadcast; the durable
 * retry path calls it again (and only it) for any tx stuck in `awaiting_receipt`.
 *
 * Receipt status is scheme-agnostic — a mined tx either succeeded or reverted
 * regardless of which proxy it called — so ONE confirm serves both upto and
 * exact.
 *
 * Mapping (mirrors settle's terminal outcomes):
 *   - receipt success  → { success: true, transaction, network, settledAmount }
 *   - receipt reverted → transaction_reverted: <txHash>      (DEFINITIVE failure)
 *   - lookup throws    → settlement_pending_receipt: <txHash> (UNKNOWN — confirm
 *                        again later; the tx is real, never re-broadcast it)
 *
 * Never throws: like settle, it returns a typed SettleResponse so callers can
 * classify the outcome as data rather than branch on exceptions.
 */
export async function confirmSettlement(
  signer: Pick<FacilitatorSigner, "waitForTransactionReceipt">,
  args: {
    txHash: `0x${string}`;
    network: Network;
    /** Amount the original settle authorized on-chain (echoed back on success). */
    settledAmount: string;
  },
): Promise<SettleResponse> {
  const { txHash, network, settledAmount } = args;
  try {
    // Bounded wait (Finding 2): keeps the worst-case settle wall-clock below the
    // orchestrator's in_flight lease so a still-mid-broadcast claim is never
    // reclaimed and double-broadcast.
    const receipt = await signer.waitForTransactionReceipt({
      hash: txHash,
      timeout: SETTLEMENT_RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status === "reverted") {
      return {
        success: false,
        errorReason: `transaction_reverted: ${txHash}`,
      };
    }
    return {
      success: true,
      transaction: txHash,
      network,
      settledAmount,
    };
  } catch {
    // Receipt unknown — the tx is real and may yet confirm. Signal pending so
    // the orchestrator records awaiting_receipt and confirms again later.
    return {
      success: false,
      errorReason: `settlement_pending_receipt: ${txHash}`,
    };
  }
}
