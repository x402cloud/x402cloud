import type { PaymentRequirements, SettleResponse } from "@x402cloud/protocol";
import type { FacilitatorSigner, ExactPayload } from "../types.js";
import {
  X402_EXACT_PROXY,
  EXACT_WITNESS_FIELDS,
  exactProxyAbi,
} from "../constants.js";
import { parseChainId, parseUnixSeconds } from "../utils.js";
import { verifyPermit2Signature } from "../shared.js";
import { broadcastAndConfirm } from "../settle-shared.js";

/**
 * Settle an exact payment on-chain for the full authorized amount.
 * No metered amount — settlement = full authorization.
 */
export async function settleExact(
  signer: FacilitatorSigner,
  payload: ExactPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  const { permit2Authorization, signature } = payload;
  const { from, permitted, nonce, deadline, witness } = permit2Authorization;

  // Re-check deadline before submitting on-chain.
  const deadlineSec = parseUnixSeconds(deadline);
  if (deadlineSec === null) {
    return { success: false, errorReason: "invalid_deadline" };
  }
  if (deadlineSec < BigInt(Math.floor(Date.now() / 1000))) {
    return { success: false, errorReason: "deadline_expired" };
  }

  // Signature-only tamper check (no on-chain reads — contract enforces balance/allowance)
  const chainId = parseChainId(requirements.network);
  try {
    const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_EXACT_PROXY, EXACT_WITNESS_FIELDS);
    if (!isValidSig) {
      return { success: false, errorReason: "tampered_payload" };
    }
  } catch {
    return { success: false, errorReason: "signature_check_failed" };
  }

  // Sign → send → confirm (Finding 1). The shared helper separates SIGNING (no
  // network — a throw means no tx) from SENDING (a throw may leave a live tx, so
  // it returns settlement_pending_receipt:<hash> to CONFIRM, never re-broadcast).
  // No amount param — exact settles the full authorization.
  return broadcastAndConfirm(
    signer,
    {
      address: X402_EXACT_PROXY,
      abi: exactProxyAbi,
      functionName: "settle",
      args: [
        {
          permitted: {
            token: permitted.token,
            amount: BigInt(permitted.amount),
          },
          nonce: BigInt(nonce),
          deadline: BigInt(deadline),
        },
        from,
        {
          to: witness.to,
          validAfter: BigInt(witness.validAfter),
        },
        signature,
      ],
    },
    { network: requirements.network, settledAmount: permitted.amount },
  );
}
