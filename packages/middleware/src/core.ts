import type { MiddlewareHandler } from "hono";
import {
  extractPaymentHeader,
  decodePaymentHeader,
  parseUsdcAmount,
  encodeRequirementsHeader,
  type VerifyResponse,
  type SettleResponse,
  type PaymentRequirements,
} from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES, type UptoPayload } from "@x402cloud/evm";
import type { UptoRoutesConfig } from "./types.js";
import { buildPaymentRequired } from "./response.js";

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

/**
 * Core x402 upto payment middleware scaffold.
 * The payment protocol flow is implemented once — verify/settle strategies are injected.
 */
export function buildUptoMiddleware(
  routes: UptoRoutesConfig,
  verify: VerifyFn,
  settle: SettleFn,
): MiddlewareHandler {
  return async (c, next) => {
    const routeKey = `${c.req.method} ${new URL(c.req.url).pathname}`;
    const routeConfig = routes[routeKey];

    if (!routeConfig) {
      return next();
    }

    const asset = routeConfig.asset ?? DEFAULT_USDC_ADDRESSES[routeConfig.network];
    if (!asset) {
      return c.json({ error: "Server misconfiguration: no asset for network" }, 500);
    }

    const paymentHeader = extractPaymentHeader(c.req.raw);

    if (!paymentHeader) {
      const paymentRequired = buildPaymentRequired(routeConfig, c.req.url);
      const encoded = encodeRequirementsHeader(paymentRequired);
      return c.json(paymentRequired, 402, {
        "PAYMENT-REQUIRED": encoded,
      });
    }

    // Decode payment payload
    let uptoPayload: UptoPayload;
    try {
      const fullPayload = decodePaymentHeader(paymentHeader);
      uptoPayload = fullPayload.payload as unknown as UptoPayload;
    } catch {
      return c.json({ error: "Invalid payment header" }, 400);
    }

    const requirements: PaymentRequirements = {
      scheme: "upto",
      network: routeConfig.network,
      asset,
      maxAmount: parseUsdcAmount(routeConfig.maxPrice),
      payTo: routeConfig.payTo,
      maxTimeoutSeconds: routeConfig.maxTimeoutSeconds ?? 300,
    };

    // Verify payment authorization
    const verification = await verify(uptoPayload, requirements);

    if (!verification.isValid) {
      const status = verification.invalidReason === "permit2_allowance_required" ? 412 : 402;
      const paymentRequired = buildPaymentRequired(routeConfig, c.req.url);
      return c.json(
        {
          error: "Payment verification failed",
          reason: verification.invalidReason,
          ...paymentRequired,
        },
        status,
        { "PAYMENT-REQUIRED": encodeRequirementsHeader(paymentRequired) },
      );
    }

    // Execute the route handler
    await next();

    if (c.res.status >= 400) {
      return;
    }

    // Meter actual usage
    const consumedAmount = await routeConfig.meter({
      request: c.req.raw,
      response: c.res,
      authorizedAmount: uptoPayload.permit2Authorization.permitted.amount,
      payer: verification.payer!,
    });

    // Settle (fire-and-forget)
    settle(uptoPayload, requirements, consumedAmount).catch(() => {});

    c.header("X-Payment-Settled", consumedAmount);
    c.header("X-Payment-Payer", verification.payer!);
  };
}
