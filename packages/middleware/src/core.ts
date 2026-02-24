import type { MiddlewareHandler } from "hono";
import {
  parseUsdcAmount,
  type VerifyResponse,
  type PaymentRequirements,
} from "@x402cloud/protocol";
import { type UptoPayload, parseUptoPayload } from "@x402cloud/evm";
import type { UptoRoutesConfig } from "./types.js";
import { buildPaymentRequired } from "./response.js";
import { processPayment, buildMiddleware, type PaymentStrategy, type PaymentFlowResult, type MiddlewareOptions } from "./generic-core.js";

// Re-export PaymentFlowResult for backward compatibility
export type { PaymentFlowResult } from "./generic-core.js";

/** Verify function: takes payload + requirements, returns verification result */
export type VerifyFn = (
  payload: UptoPayload,
  requirements: PaymentRequirements,
) => Promise<VerifyResponse>;

/** Settle function: takes payload + requirements + metered amount, returns void (fire-and-forget) */
export type SettleFn = (
  payload: UptoPayload,
  requirements: PaymentRequirements,
  settlementAmount: string,
) => Promise<void>;

/** Build the upto payment strategy from verify/settle functions */
function uptoStrategy(verify: VerifyFn, settle: SettleFn): PaymentStrategy<UptoRoutesConfig[string], UptoPayload> {
  return {
    scheme: "upto",
    getPrice: (routeConfig) => parseUsdcAmount(routeConfig.maxPrice),
    castPayload: (decoded) => parseUptoPayload(decoded),
    buildPaymentRequired,
    verify,
    buildSettle: (payload, requirements, verification, request, routeConfig, options) => {
      return async (response: Response) => {
        if (response.status >= 400) {
          return null;
        }

        // Meter actual usage
        const consumedAmount = await routeConfig.meter({
          request,
          response,
          authorizedAmount: payload.permit2Authorization.permitted.amount,
          payer: verification.payer,
        });

        // Record settlement intent before firing (if hook provided)
        if (options?.onSettlementIntent) {
          await options.onSettlementIntent({
            id: crypto.randomUUID(),
            payload,
            requirements,
            settlementAmount: consumedAmount,
            scheme: "upto",
            createdAt: Date.now(),
          });
        }

        // Settle (fire-and-forget — use waitUntil if available for durability)
        const settlePromise = settle(payload, requirements, consumedAmount).catch((err) => {
          console.error("x402 upto settlement failed:", err);
        });
        if (options?.waitUntil) {
          options.waitUntil(settlePromise);
        }

        return { settledAmount: consumedAmount, payer: verification.payer };
      };
    },
  };
}

/**
 * Framework-agnostic x402 upto payment processing.
 * Handles route matching, payment extraction, verification, and settlement.
 * Returns a discriminated union describing what the framework adapter should do.
 */
export async function processUptoPayment(
  method: string,
  pathname: string,
  request: Request,
  routes: UptoRoutesConfig,
  verify: VerifyFn,
  settle: SettleFn,
  options?: MiddlewareOptions,
): Promise<PaymentFlowResult> {
  return processPayment(method, pathname, request, routes, uptoStrategy(verify, settle), options);
}

/**
 * Core x402 upto payment middleware scaffold for Hono.
 * Thin adapter around the framework-agnostic processUptoPayment.
 */
export function buildUptoMiddleware(
  routes: UptoRoutesConfig,
  verify: VerifyFn,
  settle: SettleFn,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  return buildMiddleware(routes, uptoStrategy(verify, settle), options);
}
