import type { PaymentRequirements } from "@x402cloud/protocol";
import type { ClientSigner, UptoPayload, UptoWitness } from "../types.js";
import { X402_UPTO_PROXY, UPTO_WITNESS_FIELDS } from "../constants.js";
import { createPermit2Payload } from "../shared.js";
import { facilitatorFromRequirements } from "./facilitator.js";

/**
 * Create a signed upto payment payload.
 * Client authorizes UP TO maxAmount. Server settles for actual usage.
 *
 * The canonical upto witness binds the settling facilitator, so the server
 * MUST advertise its settlement address in `requirements.extra.facilitator`
 * (the middleware does this in its 402 response). Throws if absent.
 */
export async function createUptoPayload(
  signer: ClientSigner,
  requirements: PaymentRequirements,
): Promise<UptoPayload> {
  const facilitator = facilitatorFromRequirements(requirements);
  if (!facilitator) {
    throw new Error(
      "upto requirements missing extra.facilitator (the settlement address the witness must bind) — server must advertise it in the 402 response",
    );
  }
  return createPermit2Payload<UptoWitness>(
    signer,
    requirements,
    X402_UPTO_PROXY,
    UPTO_WITNESS_FIELDS,
    { facilitator },
  );
}
