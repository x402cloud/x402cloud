import type { MiddlewareHandler } from "hono";
import {
  extractPaymentHeader,
  decodePaymentHeader,
  encodeRequirementsHeader,
  type Network,
  type VerifyResponse,
  type PaymentRequirements,
  type PaymentRequired,
} from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES } from "@x402cloud/evm";

/** A durable record of intent to settle, captured BEFORE the settle call fires */
export type SettlementIntent = {
  id: string;
  payload: unknown;
  requirements: PaymentRequirements;
  settlementAmount: string;
  scheme: string;
  createdAt: number;
};

/** Callback to durably record a settlement intent before the settle call fires */
export type OnSettlementIntent = (intent: SettlementIntent) => Promise<void>;

/** Options for buildMiddleware beyond routes and strategy */
export type MiddlewareOptions = {
  /** Called with settlement intent data before the settle call fires, for durable recording */
  onSettlementIntent?: OnSettlementIntent;
  /** Wraps the background settlement promise (e.g., Cloudflare Workers ctx.waitUntil) */
  waitUntil?: (promise: Promise<unknown>) => void;
};

/** Result of processing the payment flow, framework-agnostic */
export type PaymentFlowResult =
  | { action: "pass" }
  | { action: "payment_required"; response: PaymentRequired; encoded: string }
  | { action: "invalid_payment"; status: number; body: object; encoded: string }
  | { action: "error"; status: number; body: object }
  | {
      action: "verified";
      payer: string;
      /**
       * Call after the route handler completes with the handler's response.
       * Returns settlement headers to set on the response, or null if the
       * handler returned an error (status >= 400) and settlement was skipped.
       */
      settle: (response: Response) => Promise<{ settledAmount: string; payer: string } | null>;
    };

/** Base route config fields shared by upto and exact */
type BaseRouteConfig = {
  network: Network;
  payTo: string;
  asset?: string;
  maxTimeoutSeconds?: number;
  description?: string;
};

/**
 * Strategy object that captures the differences between upto and exact payment schemes.
 * The generic processPayment function delegates to these hooks.
 */
export type PaymentStrategy<TRouteConfig extends BaseRouteConfig, TPayload> = {
  /** The scheme name: "upto" or "exact" */
  scheme: "upto" | "exact";

  /** Extract the price string from the route config (maxPrice for upto, price for exact) */
  getPrice: (routeConfig: TRouteConfig) => string;

  /** Cast the decoded payload to the scheme-specific type */
  castPayload: (decoded: unknown) => TPayload;

  /** Build the 402 PaymentRequired response body */
  buildPaymentRequired: (routeConfig: TRouteConfig, resourceUrl: string) => PaymentRequired;

  /** Verify the payment authorization */
  verify: (payload: TPayload, requirements: PaymentRequirements) => Promise<VerifyResponse>;

  /** Build the settle callback returned in the "verified" result */
  buildSettle: (
    payload: TPayload,
    requirements: PaymentRequirements,
    verification: VerifyResponse & { isValid: true },
    request: Request,
    routeConfig: TRouteConfig,
    options?: MiddlewareOptions,
  ) => (response: Response) => Promise<{ settledAmount: string; payer: string } | null>;
};

/**
 * Framework-agnostic x402 payment processing, parameterized by a PaymentStrategy.
 * Handles route matching, payment extraction, verification, and settlement delegation.
 */
export async function processPayment<TRouteConfig extends BaseRouteConfig, TPayload>(
  method: string,
  pathname: string,
  request: Request,
  routes: Record<string, TRouteConfig>,
  strategy: PaymentStrategy<TRouteConfig, TPayload>,
  options?: MiddlewareOptions,
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
    const paymentRequired = strategy.buildPaymentRequired(routeConfig, request.url);
    const encoded = encodeRequirementsHeader(paymentRequired);
    return { action: "payment_required", response: paymentRequired, encoded };
  }

  // Decode payment payload
  let payload: TPayload;
  try {
    const fullPayload = decodePaymentHeader(paymentHeader);
    payload = strategy.castPayload(fullPayload.payload);
  } catch {
    return { action: "error", status: 400, body: { error: "Invalid payment header" } };
  }

  const requirements: PaymentRequirements = {
    scheme: strategy.scheme,
    network: routeConfig.network,
    asset,
    maxAmount: strategy.getPrice(routeConfig),
    payTo: routeConfig.payTo,
    maxTimeoutSeconds: routeConfig.maxTimeoutSeconds ?? 300,
  };

  // Verify payment authorization
  const verification = await strategy.verify(payload, requirements);

  if (!verification.isValid) {
    const status = verification.invalidReason === "permit2_allowance_required" ? 412 : 402;
    const paymentRequired = strategy.buildPaymentRequired(routeConfig, request.url);
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

  return {
    action: "verified",
    payer: verification.payer,
    settle: strategy.buildSettle(
      payload,
      requirements,
      verification as VerifyResponse & { isValid: true },
      request,
      routeConfig,
      options,
    ),
  };
}

/**
 * Generic Hono middleware adapter around processPayment.
 * Thin adapter that maps PaymentFlowResult to Hono response handling.
 *
 * When running on Cloudflare Workers (or any runtime with `executionCtx.waitUntil`),
 * the middleware automatically uses `waitUntil` to keep the worker alive for settlement.
 * An explicit `options.waitUntil` overrides this auto-detection.
 */
export function buildMiddleware<TRouteConfig extends BaseRouteConfig, TPayload>(
  routes: Record<string, TRouteConfig>,
  strategy: PaymentStrategy<TRouteConfig, TPayload>,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  return async (c, next) => {
    // Derive per-request waitUntil from Hono's executionCtx (Cloudflare Workers),
    // unless an explicit waitUntil was provided at construction time.
    // Accessing c.executionCtx throws in non-Workers runtimes, so we guard with try-catch.
    let perRequestWaitUntil = options?.waitUntil;
    if (!perRequestWaitUntil) {
      try {
        const execCtx = (c as any).executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
        if (execCtx?.waitUntil) {
          perRequestWaitUntil = execCtx.waitUntil.bind(execCtx);
        }
      } catch {
        // Not running in a Workers-like environment; no waitUntil available
      }
    }
    const effectiveOptions: MiddlewareOptions = {
      ...options,
      ...(perRequestWaitUntil ? { waitUntil: perRequestWaitUntil } : {}),
    };

    const result = await processPayment(
      c.req.method,
      new URL(c.req.url).pathname,
      c.req.raw,
      routes,
      strategy,
      effectiveOptions,
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
