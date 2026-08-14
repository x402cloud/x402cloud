import type { MiddlewareHandler } from "hono";
import {
  parseUsdcAmount,
  type VerifyResponse,
  type SettleResponse,
  type PaymentRequirements,
} from "@x402cloud/protocol";
import { type UptoPayload, parseUptoPayload } from "@x402cloud/evm";
import type { UptoRoutesConfig } from "./types.js";
import { buildPaymentRequired } from "./response.js";
import { processPayment, buildMiddleware, runSettlement, type PaymentStrategy, type PaymentFlowResult, type MiddlewareOptions, type SettlementIntent } from "./generic-core.js";

// Re-export PaymentFlowResult for backward compatibility
export type { PaymentFlowResult } from "./generic-core.js";

/** Verify function: takes payload + requirements, returns verification result */
export type VerifyFn = (
  payload: UptoPayload,
  requirements: PaymentRequirements,
) => Promise<VerifyResponse>;

/**
 * Settle function: takes payload + requirements + metered amount, returns the
 * on-chain settlement outcome. Returning the `SettleResponse` (rather than
 * void) lets the middleware record whether payment was actually collected —
 * a failure here means service was delivered but money was not.
 */
export type SettleFn = (
  payload: UptoPayload,
  requirements: PaymentRequirements,
  settlementAmount: string,
) => Promise<SettleResponse>;

/**
 * Build the upto payment strategy from verify/settle functions.
 * `facilitator` is the settlement wallet address advertised in the 402
 * response (`extra.facilitator`) — the canonical upto witness binds it.
 */
function uptoStrategy(verify: VerifyFn, settle: SettleFn, facilitator: `0x${string}`): PaymentStrategy<UptoRoutesConfig[string], UptoPayload> {
  return {
    scheme: "upto",
    getPrice: (routeConfig) => parseUsdcAmount(routeConfig.maxPrice),
    castPayload: (decoded) => parseUptoPayload(decoded),
    buildPaymentRequired: (routeConfig, resourceUrl) => buildPaymentRequired(routeConfig, resourceUrl, facilitator),
    // Verify against the same facilitator we advertise — the canonical upto
    // witness binds it, so requirements.extra must carry it for verification.
    requirementsExtra: { facilitator },
    verify,
    buildSettle: (payload, requirements, verification, request, routeConfig, options) => {
      return async (response: Response) => {
        if (response.status >= 400) {
          return null;
        }

        // Meter actual usage. settlementFee/feeDegraded ride the verify result
        // that already admitted this request (workspace#45) — the meter can
        // floor its retail price at the current gas cost without a second
        // call to the facilitator.
        const consumedAmount = await routeConfig.meter({
          request,
          response,
          authorizedAmount: payload.permit2Authorization.permitted.amount,
          payer: verification.payer,
          settlementFee: verification.settlementFee,
          feeDegraded: verification.feeDegraded,
        });

        // One settlement intent: its id ties the pre-fire record to the
        // post-resolve outcome, and it carries the payload for onSettlementError.
        const intent: SettlementIntent = {
          id: crypto.randomUUID(),
          payload,
          requirements,
          settlementAmount: consumedAmount,
          scheme: "upto",
          createdAt: Date.now(),
        };

        // Record settlement intent before firing (if hook provided).
        if (options?.onSettlementIntent) {
          await options.onSettlementIntent(intent);
        }

        // Settle as a durable background task — outcome is recorded via
        // onSettlementResult (success or failure), a thrown settle is forwarded
        // to onSettlementError, and waitUntil keeps it alive. Never swallowed.
        runSettlement(() => settle(payload, requirements, consumedAmount), intent, options);

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
  facilitator: `0x${string}`,
  options?: MiddlewareOptions,
): Promise<PaymentFlowResult> {
  return processPayment(method, pathname, request, routes, uptoStrategy(verify, settle, facilitator), options);
}

/**
 * Core x402 upto payment middleware scaffold for Hono.
 * Thin adapter around the framework-agnostic processUptoPayment.
 */
export function buildUptoMiddleware(
  routes: UptoRoutesConfig,
  verify: VerifyFn,
  settle: SettleFn,
  facilitator: `0x${string}`,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  return buildMiddleware(routes, uptoStrategy(verify, settle, facilitator), options);
}
