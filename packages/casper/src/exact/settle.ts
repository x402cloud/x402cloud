import type { PaymentRequirements, SettleResponse } from "@x402cloud/protocol";
import type { CasperFacilitatorClient } from "../facilitator-client.js";
import { facilitatorRequestBody, preflight } from "../shared.js";

type SettleBody = {
  success?: unknown;
  transaction?: unknown;
  /** Some facilitator builds name the deploy hash explicitly. */
  deployHash?: unknown;
  network?: unknown;
  settledAmount?: unknown;
  errorReason?: unknown;
};

/**
 * Settle a Casper `exact` payment.
 *
 * The hosted facilitator signs and submits the wCSPR CEP-18 deploy — this
 * package never holds a Casper secret key — and returns the deploy hash once
 * the deploy is accepted.
 *
 * Fails CLOSED: any transport error, timeout, non-2xx status, or unparseable
 * body resolves to `success: false`. We never report a settlement we cannot
 * name a deploy hash for, because a caller that believes it was paid will
 * release the resource for free.
 */
export async function settleExact(
  client: CasperFacilitatorClient,
  payload: Record<string, unknown>,
  requirements: PaymentRequirements,
  env: Record<string, string | undefined> = process.env,
): Promise<SettleResponse> {
  const pre = preflight(payload, requirements, env);
  if (!pre.ok) return { success: false, errorReason: pre.reason };

  const res = await client.post<SettleBody>(
    "/settle",
    facilitatorRequestBody(pre.payload, requirements),
  );
  if (!res.ok) return { success: false, errorReason: res.reason };

  const body = res.body;
  if (body.success !== true) {
    const reason =
      typeof body.errorReason === "string" && body.errorReason.length > 0
        ? body.errorReason
        : "settlement_failed";
    return { success: false, errorReason: reason };
  }

  const transaction =
    typeof body.transaction === "string" && body.transaction.length > 0
      ? body.transaction
      : typeof body.deployHash === "string" && body.deployHash.length > 0
        ? body.deployHash
        : null;
  if (!transaction) {
    // 2xx + success:true but no deploy hash is unverifiable. Treat it as a
    // failure rather than telling the caller a payment landed.
    return { success: false, errorReason: "facilitator_malformed_response" };
  }

  const settledAmount =
    typeof body.settledAmount === "string" && body.settledAmount.length > 0
      ? body.settledAmount
      : pre.payload.authorization.value;

  return {
    success: true,
    transaction,
    network: requirements.network,
    settledAmount,
  };
}
