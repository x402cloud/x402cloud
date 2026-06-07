import type { Network, SettleResponse } from "@x402cloud/protocol";
import type { FacilitatorSigner } from "./types.js";
import { confirmSettlement } from "./confirm.js";
import { sanitizeErrorMessage } from "./errors.js";

/**
 * Shared settle broadcast for both schemes: SIGN → SEND → CONFIRM.
 *
 * This split is the Finding 1 fix. `eth_sendRawTransaction` can accept a signed
 * tx into the mempool and THEN lose its HTTP response (timeout / reset / 5xx).
 * A one-shot writeContract throws in that case while the tx is live and will
 * mine — consuming the single-use Permit2 nonce and moving USDC. Treating that
 * throw as "no tx" and re-broadcasting reverts on the consumed nonce and gets
 * recorded as a failure even though the payer was charged = LOST REVENUE.
 *
 * So we separate the deterministic, network-free SIGNING (which yields the tx
 * hash) from the SENDING. The terminal outcomes map exactly:
 *
 *   sign throws        → settlement_failed: <msg>      (TRULY no tx — retry as a
 *                                                       fresh broadcast)
 *   send throws        → settlement_pending_receipt:<hash>  (a tx MAY be live; we
 *                                                       hold its hash — CONFIRM,
 *                                                       NEVER re-broadcast) [I1]
 *   receipt reverted   → transaction_reverted: <hash>  (DEFINITIVE failure)
 *   receipt success    → success
 *   receipt-wait throws→ settlement_pending_receipt:<hash>  (UNKNOWN — confirm
 *                                                       again later)
 *
 * Fallback: a signer that does NOT provide the two-step port (signSettlementTx +
 * sendRawSettlementTx) — e.g. a locally-composed middleware signer — uses the
 * legacy one-shot writeContract. That path keeps the prior, ambiguous behaviour
 * (a throw → settlement_failed); the hosted facilitator provides the two-step
 * port so the Finding 1 protection applies where the eventually-consistent KV
 * makes it matter.
 */
export async function broadcastAndConfirm(
  signer: FacilitatorSigner,
  tx: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  },
  result: { network: Network; settledAmount: string },
): Promise<SettleResponse> {
  const { network, settledAmount } = result;

  // Two-step port present → SIGN then SEND so a send-time throw is recoverable.
  if (signer.signSettlementTx && signer.sendRawSettlementTx) {
    // 1. SIGN — pure local crypto, no network. A throw here means NO tx exists
    //    (nonce untouched, no USDC moved) → safe to re-broadcast → TRANSIENT.
    let hash: `0x${string}`;
    let serialized: `0x${string}`;
    try {
      ({ hash, serialized } = await signer.signSettlementTx(tx));
    } catch (err) {
      return {
        success: false,
        errorReason: `settlement_failed: ${sanitizeErrorMessage(err)}`,
      };
    }

    // 2. SEND — broadcast the raw tx. A throw here does NOT prove "no tx": the
    //    node may have accepted it into the mempool before losing the response.
    //    We already hold the deterministic hash, so signal pending — CONFIRM it,
    //    NEVER re-broadcast (I1).
    try {
      await signer.sendRawSettlementTx(serialized);
    } catch {
      return {
        success: false,
        errorReason: `settlement_pending_receipt: ${hash}`,
      };
    }

    // 3. CONFIRM the known hash (receipt wait): reverted → transaction_reverted,
    //    success → success, wait-throw → settlement_pending_receipt:<hash>.
    return confirmSettlement(signer, { txHash: hash, network, settledAmount });
  }

  // Fallback: legacy one-shot sign+send. A throw is ambiguous (Finding 1), but
  // this path exists only for signers without the two-step port.
  if (!signer.writeContract) {
    return {
      success: false,
      errorReason: "settlement_failed: signer provides neither signSettlementTx nor writeContract",
    };
  }
  let txHash: `0x${string}`;
  try {
    txHash = await signer.writeContract(tx);
  } catch (err) {
    return {
      success: false,
      errorReason: `settlement_failed: ${sanitizeErrorMessage(err)}`,
    };
  }
  return confirmSettlement(signer, { txHash, network, settledAmount });
}
