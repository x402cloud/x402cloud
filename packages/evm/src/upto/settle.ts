import type { PaymentRequirements, SettleResponse } from "@x402cloud/protocol";
import type { FacilitatorSigner, UptoPayload } from "../types.js";
import {
  X402_UPTO_PROXY,
  uptoProxyAbi,
} from "../constants.js";
import { parseChainId } from "../utils.js";
import { verifyPermit2Signature } from "../shared.js";

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

  // Guard: settlement cannot exceed authorization
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

  // Signature-only tamper check (no on-chain reads — contract enforces balance/allowance)
  const chainId = parseChainId(requirements.network);
  try {
    const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_UPTO_PROXY);
    if (!isValidSig) {
      return { success: false, errorReason: "tampered_payload" };
    }
  } catch {
    return { success: false, errorReason: "signature_check_failed" };
  }

  // Call the upto proxy's settle() function
  try {
    const txHash = await signer.writeContract({
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
        errorReason: `transaction_reverted: ${txHash}`,
      };
    }

    return {
      success: true,
      transaction: txHash,
      network: requirements.network,
      settledAmount: settlementAmount,
    };
  } catch (err) {
    return {
      success: false,
      errorReason: `settlement_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
