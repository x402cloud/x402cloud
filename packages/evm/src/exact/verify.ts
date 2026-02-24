import type { PaymentRequirements, VerifyResponse } from "@x402cloud/protocol";
import type { VerifySigner, ExactPayload } from "../types.js";
import {
  PERMIT2_ADDRESS,
  X402_EXACT_PROXY,
  erc20Abi,
} from "../constants.js";
import { parseChainId } from "../utils.js";
import { verifyPermit2Signature } from "../upto/shared.js";

/**
 * Verify an exact payment authorization.
 * Checks signature, spender, recipient, deadline, balance, and allowance.
 */
export async function verifyExact(
  signer: VerifySigner,
  payload: ExactPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> {
  const { permit2Authorization, signature } = payload;
  const { from, permitted, spender, deadline, witness } = permit2Authorization;
  const now = Math.floor(Date.now() / 1000);

  // 1. Spender must be the exact proxy
  if (spender.toLowerCase() !== X402_EXACT_PROXY.toLowerCase()) {
    return { isValid: false, invalidReason: "invalid_spender" };
  }

  // 2. Recipient must match payTo
  if (witness.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "invalid_recipient" };
  }

  // 3. Deadline not expired (6-second buffer for block time)
  if (parseInt(deadline) < now + 6) {
    return { isValid: false, invalidReason: "deadline_expired" };
  }

  // 4. validAfter is in the past
  if (parseInt(witness.validAfter) > now) {
    return { isValid: false, invalidReason: "not_yet_valid" };
  }

  // 5. Authorized amount >= server's maxAmount
  if (BigInt(permitted.amount) < BigInt(requirements.maxAmount)) {
    return { isValid: false, invalidReason: "insufficient_authorized_amount" };
  }

  // 6. Verify EIP-712 signature
  const chainId = parseChainId(requirements.network);
  try {
    const isValidSig = await verifyPermit2Signature(signer, permit2Authorization, signature, chainId, X402_EXACT_PROXY);
    if (!isValidSig) {
      return { isValid: false, invalidReason: "invalid_signature" };
    }
  } catch {
    return { isValid: false, invalidReason: "signature_verification_failed" };
  }

  // 7. Check Permit2 allowance (payer must have approved Permit2)
  try {
    const allowance = (await signer.readContract({
      address: permitted.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [from, PERMIT2_ADDRESS],
    })) as bigint;
    if (allowance < BigInt(permitted.amount)) {
      return { isValid: false, invalidReason: "permit2_allowance_required" };
    }
  } catch {
    return { isValid: false, invalidReason: "allowance_check_failed" };
  }

  // 8. Check token balance
  try {
    const balance = (await signer.readContract({
      address: permitted.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [from],
    })) as bigint;
    if (balance < BigInt(permitted.amount)) {
      return { isValid: false, invalidReason: "insufficient_balance" };
    }
  } catch {
    return { isValid: false, invalidReason: "balance_check_failed" };
  }

  return { isValid: true, payer: from };
}
