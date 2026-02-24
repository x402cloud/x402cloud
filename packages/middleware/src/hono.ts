import type { MiddlewareHandler } from "hono";
import { verifyUpto, settleUpto, verifyExact, settleExact, type FacilitatorSigner } from "@x402cloud/evm";
import type { UptoRoutesConfig, ExactRoutesConfig } from "./types.js";
import { buildUptoMiddleware } from "./core.js";
import { buildExactMiddleware } from "./exact-core.js";
import type { MiddlewareOptions } from "./generic-core.js";

/**
 * Hono middleware for x402 upto payments with a local FacilitatorSigner.
 * Use when the server holds a private key (e.g., standalone facilitator).
 */
export function uptoPaymentMiddleware(
  routes: UptoRoutesConfig,
  signer: FacilitatorSigner,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  return buildUptoMiddleware(
    routes,
    (payload, requirements) => verifyUpto(signer, payload, requirements),
    async (payload, requirements, settlementAmount) => {
      await settleUpto(signer, payload, requirements, settlementAmount);
    },
    options,
  );
}

/**
 * Hono middleware for x402 exact payments with a local FacilitatorSigner.
 * Use when the server holds a private key (e.g., standalone facilitator).
 */
export function exactPaymentMiddleware(
  routes: ExactRoutesConfig,
  signer: FacilitatorSigner,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  return buildExactMiddleware(
    routes,
    (payload, requirements) => verifyExact(signer, payload, requirements),
    async (payload, requirements) => {
      await settleExact(signer, payload, requirements);
    },
    options,
  );
}
