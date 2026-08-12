import type { PaymentRequirements, VerifyResponse } from "@x402cloud/protocol";
import type { CasperFacilitatorClient } from "../facilitator-client.js";
import { facilitatorRequestBody, preflight } from "../shared.js";

type VerifyBody = {
  isValid?: unknown;
  payer?: unknown;
  invalidReason?: unknown;
};

/**
 * Verify a Casper `exact` payment authorization.
 *
 * Local structural checks run first; the signature, balance, allowance, and
 * replay checks are performed by the hosted facilitator (`POST /verify`), which
 * is the only party with a Casper node view.
 *
 * Fails CLOSED: an unreachable facilitator, a timeout, a non-2xx status, or a
 * response we cannot parse all resolve to `isValid: false`. There is no code
 * path where an infrastructure failure yields a valid payment.
 */
export async function verifyExact(
  client: CasperFacilitatorClient,
  payload: Record<string, unknown>,
  requirements: PaymentRequirements,
  env: Record<string, string | undefined> = process.env,
): Promise<VerifyResponse> {
  const pre = preflight(payload, requirements, env);
  if (!pre.ok) return { isValid: false, invalidReason: pre.reason };

  const res = await client.post<VerifyBody>(
    "/verify",
    facilitatorRequestBody(pre.payload, requirements),
  );
  if (!res.ok) return { isValid: false, invalidReason: res.reason };

  const body = res.body;
  if (body.isValid === true) {
    const payer = typeof body.payer === "string" && body.payer.length > 0
      ? body.payer
      : pre.payload.authorization.from;
    return { isValid: true, payer };
  }

  const reason =
    typeof body.invalidReason === "string" && body.invalidReason.length > 0
      ? body.invalidReason
      : "invalid_payload";
  return { isValid: false, invalidReason: reason };
}
