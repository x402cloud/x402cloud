import type { PaymentRequirements } from "@x402cloud/protocol";
import type { ClientSigner, ExactPayload } from "../types.js";
import { X402_EXACT_PROXY } from "../constants.js";
import { createPermit2Payload } from "../shared.js";

/**
 * Create a signed exact payment payload.
 * Client authorizes the exact amount. Server settles for the full authorized amount.
 */
export async function createExactPayload(
  signer: ClientSigner,
  requirements: PaymentRequirements,
): Promise<ExactPayload> {
  return createPermit2Payload(signer, requirements, X402_EXACT_PROXY);
}
