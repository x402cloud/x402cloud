import type { PaymentRequirements, VerifyResponse } from "@x402cloud/protocol";
import type { VerifySigner, UptoPayload } from "../types.js";
import { X402_UPTO_PROXY, UPTO_WITNESS_FIELDS } from "../constants.js";
import { verifyPermit2Authorization } from "../shared.js";
import { facilitatorFromRequirements } from "./facilitator.js";

/**
 * Verify an upto payment authorization.
 * Checks facilitator binding, signature, spender, recipient, deadline,
 * balance, and allowance.
 * Does NOT settle on-chain — call settleUpto() after metering.
 *
 * @param facilitator The verifying facilitator's OWN settlement address. The
 * canonical upto proxy only lets `witness.facilitator` call `settle`, so a
 * payload (or advertised requirements) bound to any other address could never
 * be settled by us — fail closed here instead of at settlement time.
 */
export async function verifyUpto(
  signer: VerifySigner,
  payload: UptoPayload,
  requirements: PaymentRequirements,
  facilitator: `0x${string}`,
): Promise<VerifyResponse> {
  // Advertised facilitator must exist and be us (fail closed).
  const advertised = facilitatorFromRequirements(requirements);
  if (!advertised || advertised.toLowerCase() !== facilitator.toLowerCase()) {
    return { isValid: false, invalidReason: "facilitator_mismatch" };
  }

  // Signed witness must bind us as the settler — anything else is unsettleable.
  if (payload.permit2Authorization.witness.facilitator?.toLowerCase() !== facilitator.toLowerCase()) {
    return { isValid: false, invalidReason: "invalid_facilitator" };
  }

  return verifyPermit2Authorization(signer, payload, requirements, X402_UPTO_PROXY, UPTO_WITNESS_FIELDS);
}
