import type { MiddlewareHandler } from "hono";
import {
  parseUsdcAmount,
  type VerifyResponse,
  type SettleResponse,
  type PaymentRequirements,
} from "@x402cloud/protocol";
import { type ExactPayload, parseExactPayload } from "@x402cloud/evm";
import type { ExactRoutesConfig } from "./types.js";
import { buildExactPaymentRequired } from "./response.js";
import { processPayment, buildMiddleware, runSettlement, type PaymentStrategy, type PaymentFlowResult, type MiddlewareOptions } from "./generic-core.js";

/** Verify function: takes payload + requirements, returns verification result */
export type ExactVerifyFn = (
  payload: ExactPayload,
  requirements: PaymentRequirements,
) => Promise<VerifyResponse>;

/**
 * Settle function: takes payload + requirements, settles for full amount and
 * returns the on-chain outcome so the middleware can record whether payment
 * was actually collected.
 */
export type ExactSettleFn = (
  payload: ExactPayload,
  requirements: PaymentRequirements,
) => Promise<SettleResponse>;

/** Build the exact payment strategy from verify/settle functions */
function exactStrategy(verify: ExactVerifyFn, settle: ExactSettleFn): PaymentStrategy<ExactRoutesConfig[string], ExactPayload> {
  return {
    scheme: "exact",
    getPrice: (routeConfig) => parseUsdcAmount(routeConfig.price),
    castPayload: (decoded) => parseExactPayload(decoded),
    buildPaymentRequired: buildExactPaymentRequired,
    verify,
    buildSettle: (payload, requirements, verification, _request, routeConfig, options) => {
      const settledAmount = parseUsdcAmount(routeConfig.price);
      return async (response: Response) => {
        if (response.status >= 400) {
          return null;
        }

        // One id ties the pre-fire intent to the post-resolve outcome.
        const intentId = crypto.randomUUID();

        // Record settlement intent before firing (if hook provided)
        if (options?.onSettlementIntent) {
          await options.onSettlementIntent({
            id: intentId,
            payload,
            requirements,
            settlementAmount: settledAmount,
            scheme: "exact",
            createdAt: Date.now(),
          });
        }

        // Settle as a durable background task — outcome is recorded, not swallowed.
        runSettlement(
          () => settle(payload, requirements),
          { intentId, scheme: "exact", requirements, settlementAmount: settledAmount },
          options,
        );

        return { settledAmount, payer: verification.payer };
      };
    },
  };
}

/**
 * Framework-agnostic x402 exact payment processing.
 * Handles route matching, payment extraction, verification, and settlement.
 * Returns a discriminated union describing what the framework adapter should do.
 */
export async function processExactPayment(
  method: string,
  pathname: string,
  request: Request,
  routes: ExactRoutesConfig,
  verify: ExactVerifyFn,
  settle: ExactSettleFn,
  options?: MiddlewareOptions,
): Promise<PaymentFlowResult> {
  return processPayment(method, pathname, request, routes, exactStrategy(verify, settle), options);
}

/**
 * Core x402 exact payment middleware scaffold for Hono.
 * Thin adapter around the framework-agnostic processExactPayment.
 */
export function buildExactMiddleware(
  routes: ExactRoutesConfig,
  verify: ExactVerifyFn,
  settle: ExactSettleFn,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  return buildMiddleware(routes, exactStrategy(verify, settle), options);
}
