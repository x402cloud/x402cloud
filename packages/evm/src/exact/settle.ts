import type { PaymentRequirements, SettleResponse } from "@x402cloud/protocol";
import type { FacilitatorSigner, ExactPayload } from "../types.js";
import {
  X402_EXACT_PROXY,
  exactProxyAbi,
} from "../constants.js";
import { parseChainId } from "../utils.js";
import { verifyPermit2Signature } from "../upto/shared.js";

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

  // Signature-only tamper check (no on-chain reads — contract enforces balance/allowance)
  const chainId = parseChainId(requirements.network);
  try {
    const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_EXACT_PROXY);
    if (!isValidSig) {
      return { success: false, errorReason: "tampered_payload" };
    }
  } catch {
    return { success: false, errorReason: "signature_check_failed" };
  }

  // Call the exact proxy's settle() function (no amount param — settles full authorization)
  try {
    const txHash = await signer.writeContract({
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
          extra: witness.extra,
        },
        signature,
      ],
    });

    // Wait for confirmation
    const receipt = await signer.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      return {
        success: false,
        errorReason: "transaction_reverted",
        transaction: txHash,
        network: requirements.network,
      };
    }

    return {
      success: true,
      transaction: txHash,
      network: requirements.network,
      settledAmount: permitted.amount,
    };
  } catch (err) {
    return {
      success: false,
      errorReason: `settlement_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
