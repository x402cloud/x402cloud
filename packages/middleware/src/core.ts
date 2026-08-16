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
 * Clamp a metered amount to the price the 402 quoted.
 *
 * The quote is a CEILING, not a suggestion. Every layer below this one clamps
 * to `permitted.amount` — the payer's signed budget — which for an agent wallet
 * is routinely orders of magnitude above one call's quote. If a meter returns
 * more than we quoted, that is our bug, and the payer should not fund it.
 *
 * Clamping (rather than refusing to settle) is deliberate: the response has
 * already been delivered, so refusing would hand out the service for free. The
 * overrun is logged loudly because a meter that exceeds its own route's
 * `maxPrice` is a pricing bug that needs fixing, not a normal condition.
 */
export function clampToQuote(metered: string, quoted: string): string {
  if (!/^\d+$/.test(metered)) {
    console.error(`x402 upto meter returned a non-integer amount "${metered}" — charging 0`);
    return "0";
  }
  if (BigInt(metered) > BigInt(quoted)) {
    console.error(
      `x402 upto meter returned ${metered} but the 402 quoted ${quoted} — clamping to the quote`,
    );
    return quoted;
  }
  return metered;
}

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
    buildPaymentRequired: (routeConfig, resourceUrl, error) =>
      buildPaymentRequired(routeConfig, resourceUrl, facilitator, error),
    // Verify against the same facilitator we advertise — the canonical upto
    // witness binds it, so requirements.extra must carry it for verification.
    requirementsExtra: { facilitator },
    verify,
    buildSettle: (payload, requirements, verification, request, routeConfig, options) => {
      return async (response: Response) => {
        if (response.status >= 400) {
          return null;
        }

        // Meter actual usage, then hold it to the price we quoted in the 402.
        const metered = await routeConfig.meter({
          request,
          response,
          authorizedAmount: payload.permit2Authorization.permitted.amount,
          payer: verification.payer,
        });
        const consumedAmount = clampToQuote(metered, requirements.amount);

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
