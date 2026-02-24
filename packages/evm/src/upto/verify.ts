import type { PaymentRequirements, VerifyResponse } from "@x402cloud/protocol";
import type { VerifySigner, UptoPayload } from "../types.js";
import { X402_UPTO_PROXY } from "../constants.js";
import { verifyPermit2Authorization } from "../shared.js";

/**
 * Verify an upto payment authorization.
 * Checks signature, spender, recipient, deadline, balance, and allowance.
 * Does NOT settle on-chain — call settleUpto() after metering.
 */
export async function verifyUpto(
  signer: VerifySigner,
  payload: UptoPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> {
  return verifyPermit2Authorization(signer, payload, requirements, X402_UPTO_PROXY);
}
