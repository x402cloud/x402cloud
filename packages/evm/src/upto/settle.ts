import type { PaymentRequirements, SettleResponse } from "@x402cloud/protocol";
import type { FacilitatorSigner, UptoPayload } from "../types.js";
import {
  X402_UPTO_PROXY,
  UPTO_WITNESS_FIELDS,
  uptoProxyAbi,
} from "../constants.js";
import { parseChainId, parseUnixSeconds } from "../utils.js";
import { verifyPermit2Signature } from "../shared.js";
import { broadcastAndConfirm } from "../settle-shared.js";

/**
 * Settle an upto payment on-chain for the actual metered amount.
 * settlementAmount is passed separately — the signed payload is immutable.
 * Only re-checks the EIP-712 signature (no on-chain RPC reads — the contract enforces balance/allowance).
 */
export async function settleUpto(
  signer: FacilitatorSigner,
  payload: UptoPayload,
  requirements: PaymentRequirements,
  settlementAmount: string,
): Promise<SettleResponse> {
  const { permit2Authorization, signature } = payload;
  const { from, permitted, nonce, deadline, witness } = permit2Authorization;

  // Guard 1: settlement cannot exceed the price the resource server QUOTED.
  //
  // This is deliberately independent of the same check in the middleware
  // (`packages/middleware/src/core.ts`). The facilitator may be remote, and the
  // resource server asking it to settle is not automatically trusted to respect
  // its own quote — a bug or a compromise there must not turn into a charge the
  // payer never saw. The payer's signed budget (`permitted.amount`) is NOT the
  // ceiling: agent clients routinely authorize a wallet budget far above one
  // call's quote, and charging up to that budget is exactly the failure this
  // rejects.
  if (BigInt(settlementAmount) > BigInt(requirements.amount)) {
    return {
      success: false,
      errorReason: "settlement_exceeds_quote",
    };
  }

  // Guard 2: settlement cannot exceed authorization (also enforced on-chain).
  if (BigInt(settlementAmount) > BigInt(permitted.amount)) {
    return {
      success: false,
      errorReason: "settlement_exceeds_authorization",
    };
  }

  // Skip zero settlements (no on-chain tx needed)
  if (BigInt(settlementAmount) === 0n) {
    return {
      success: true,
      transaction: "",
      settledAmount: "0",
      network: requirements.network,
    };
  }

  // Re-check deadline immediately before submitting on-chain. Verification
  // may have happened seconds (or minutes, with metering) earlier; submitting
  // an expired authorization just burns gas and confuses callers.
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
    const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_UPTO_PROXY, UPTO_WITNESS_FIELDS);
    if (!isValidSig) {
      return { success: false, errorReason: "tampered_payload" };
    }
  } catch {
    return { success: false, errorReason: "signature_check_failed" };
  }

  // Sign → send → confirm (Finding 1). The shared helper separates SIGNING (no
  // network — a throw means no tx) from SENDING (a throw may leave a live tx, so
  // it returns settlement_pending_receipt:<hash> to CONFIRM, never re-broadcast).
  return broadcastAndConfirm(
    signer,
    {
      address: X402_UPTO_PROXY,
      abi: uptoProxyAbi,
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
        BigInt(settlementAmount),
        from,
        {
          to: witness.to,
          facilitator: witness.facilitator,
          validAfter: BigInt(witness.validAfter),
        },
        signature,
      ],
    },
    { network: requirements.network, settledAmount: settlementAmount },
  );
}
