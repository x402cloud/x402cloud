import type { MiddlewareHandler } from "hono";
import {
  parseUsdcAmount,
  type VerifyResponse,
  type PaymentRequirements,
} from "@x402cloud/protocol";
import { type ExactPayload, parseExactPayload } from "@x402cloud/evm";
import type { ExactRoutesConfig } from "./types.js";
import { buildExactPaymentRequired } from "./response.js";
import { processPayment, buildMiddleware, type PaymentStrategy, type PaymentFlowResult, type MiddlewareOptions } from "./generic-core.js";

/** Verify function: takes payload + requirements, returns verification result */
export type ExactVerifyFn = (
  payload: ExactPayload,
  requirements: PaymentRequirements,
) => Promise<VerifyResponse>;

/** Settle function: takes payload + requirements, settles for full amount */
export type ExactSettleFn = (
  payload: ExactPayload,
  requirements: PaymentRequirements,
) => Promise<void>;

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

        // Record settlement intent before firing (if hook provided)
        if (options?.onSettlementIntent) {
          await options.onSettlementIntent({
            id: crypto.randomUUID(),
            payload,
            requirements,
            settlementAmount: settledAmount,
            scheme: "exact",
            createdAt: Date.now(),
          });
        }

        // Settle for full price (fire-and-forget — use waitUntil if available for durability)
        const settlePromise = settle(payload, requirements).catch((err) => {
          console.error("x402 exact settlement failed:", err);
        });
        if (options?.waitUntil) {
          options.waitUntil(settlePromise);
        }

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
