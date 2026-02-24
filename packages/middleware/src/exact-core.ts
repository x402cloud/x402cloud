import type { MiddlewareHandler } from "hono";
import {
  extractPaymentHeader,
  decodePaymentHeader,
  parseUsdcAmount,
  encodeRequirementsHeader,
  type VerifyResponse,
  type PaymentRequirements,
  type PaymentRequired,
} from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES, type ExactPayload } from "@x402cloud/evm";
import type { ExactRoutesConfig } from "./types.js";
import { buildExactPaymentRequired } from "./response.js";
import type { PaymentFlowResult } from "./core.js";

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
): Promise<PaymentFlowResult> {
  const routeKey = `${method} ${pathname}`;
  const routeConfig = routes[routeKey];

  if (!routeConfig) {
    return { action: "pass" };
  }

  const asset = routeConfig.asset ?? DEFAULT_USDC_ADDRESSES[routeConfig.network];
  if (!asset) {
    return { action: "error", status: 500, body: { error: "Server misconfiguration: no asset for network" } };
  }

  const paymentHeader = extractPaymentHeader(request);

  if (!paymentHeader) {
    const paymentRequired = buildExactPaymentRequired(routeConfig, request.url);
    const encoded = encodeRequirementsHeader(paymentRequired);
    return { action: "payment_required", response: paymentRequired, encoded };
  }

  // Decode payment payload
  let exactPayload: ExactPayload;
  try {
    const fullPayload = decodePaymentHeader(paymentHeader);
    exactPayload = fullPayload.payload as unknown as ExactPayload;
  } catch {
    return { action: "error", status: 400, body: { error: "Invalid payment header" } };
  }

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: routeConfig.network,
    asset,
    maxAmount: parseUsdcAmount(routeConfig.price),
    payTo: routeConfig.payTo,
    maxTimeoutSeconds: routeConfig.maxTimeoutSeconds ?? 300,
  };

  // Verify payment authorization
  const verification = await verify(exactPayload, requirements);

  if (!verification.isValid) {
    const status = verification.invalidReason === "permit2_allowance_required" ? 412 : 402;
    const paymentRequired = buildExactPaymentRequired(routeConfig, request.url);
    const encoded = encodeRequirementsHeader(paymentRequired);
    return {
      action: "invalid_payment",
      status,
      body: {
        error: "Payment verification failed",
        reason: verification.invalidReason,
        ...paymentRequired,
      },
      encoded,
    };
  }

  const settledAmount = parseUsdcAmount(routeConfig.price);

  return {
    action: "verified",
    payer: verification.payer,
    settle: async (response: Response) => {
      if (response.status >= 400) {
        return null;
      }

      // Settle for full price (fire-and-forget)
      settle(exactPayload, requirements).catch(() => {});

      return { settledAmount, payer: verification.payer };
    },
  };
}

/**
 * Core x402 exact payment middleware scaffold for Hono.
 * Thin adapter around the framework-agnostic processExactPayment.
 */
export function buildExactMiddleware(
  routes: ExactRoutesConfig,
  verify: ExactVerifyFn,
  settle: ExactSettleFn,
): MiddlewareHandler {
  return async (c, next) => {
    const result = await processExactPayment(
      c.req.method,
      new URL(c.req.url).pathname,
      c.req.raw,
      routes,
      verify,
      settle,
    );

    switch (result.action) {
      case "pass":
        return next();
      case "payment_required":
        return c.json(result.response, 402, { "PAYMENT-REQUIRED": result.encoded });
      case "invalid_payment":
        return c.json(result.body, result.status as 402 | 412, { "PAYMENT-REQUIRED": result.encoded });
      case "error":
        return c.json(result.body, result.status as 400 | 500);
      case "verified": {
        await next();
        const settlement = await result.settle(c.res);
        if (settlement) {
          c.header("X-Payment-Settled", settlement.settledAmount);
          c.header("X-Payment-Payer", settlement.payer);
        }
        return;
      }
    }
  };
}
