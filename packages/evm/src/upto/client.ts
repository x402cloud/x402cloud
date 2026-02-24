import type { PaymentRequirements } from "@x402cloud/protocol";
import type { ClientSigner, UptoPayload } from "../types.js";
import { X402_UPTO_PROXY } from "../constants.js";
import { createPermit2Payload } from "../shared.js";

/**
 * Create a signed upto payment payload.
 * Client authorizes UP TO maxAmount. Server settles for actual usage.
 */
export async function createUptoPayload(
  signer: ClientSigner,
  requirements: PaymentRequirements,
): Promise<UptoPayload> {
  return createPermit2Payload(signer, requirements, X402_UPTO_PROXY);
}
