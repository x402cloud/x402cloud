import type { PaymentRequirements, VerifyResponse } from "@x402cloud/protocol";
import type { VerifySigner, ExactPayload } from "../types.js";
import { X402_EXACT_PROXY } from "../constants.js";
import { verifyPermit2Authorization } from "../shared.js";

/**
 * Verify an exact payment authorization.
 * Checks signature, spender, recipient, deadline, balance, and allowance.
 */
export async function verifyExact(
  signer: VerifySigner,
  payload: ExactPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> {
  return verifyPermit2Authorization(signer, payload, requirements, X402_EXACT_PROXY);
}
