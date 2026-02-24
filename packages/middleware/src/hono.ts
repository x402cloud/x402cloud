import type { MiddlewareHandler } from "hono";
import { verifyUpto, settleUpto, type FacilitatorSigner } from "@x402cloud/evm";
import type { UptoRoutesConfig } from "./types.js";
import { buildUptoMiddleware } from "./core.js";

/**
 * Hono middleware for x402 upto payments with a local FacilitatorSigner.
 * Use when the server holds a private key (e.g., standalone facilitator).
 */
export function uptoPaymentMiddleware(
  routes: UptoRoutesConfig,
  signer: FacilitatorSigner,
): MiddlewareHandler {
  return buildUptoMiddleware(
    routes,
    (payload, requirements) => verifyUpto(signer, payload, requirements),
    async (payload, requirements, settlementAmount) => {
      await settleUpto(signer, payload, requirements, settlementAmount);
    },
  );
}
