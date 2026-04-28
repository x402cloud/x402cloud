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

/**
 * Reject any string that contains characters not safe for HTTP header values:
 * CR, LF, NUL, or any non-printable byte. The settlement amount and payer
 * are also further constrained by regex at the call site, but this helper
 * is a defense-in-depth check that applies to anything we propagate from
 * a (potentially remote) facilitator into our response headers.
 */
function isSafeHeaderValue(value: unknown): value is string {
  return typeof value === "string" && /^[\x20-\x7E]{1,256}$/.test(value);
}

/**
 * A durable record of intent to settle, captured BEFORE the settle call fires.
 *
 * SECURITY NOTE: `payload` contains the client's full Permit2 authorization,
 * including the EIP-712 signature. Treat it as sensitive when forwarding to
 * external systems (logs, error trackers, queues): the signature is single-use
 * but the surrounding metadata identifies the payer's address and amount.
 * Use `redactSignature()` if you only need a record of the intent, not the
 * raw signature.
 */
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

/**
 * Replace the `signature` field of an intent's payload with the marker string
 * `"[redacted]"`. Useful when forwarding intents to logs or error trackers
 * where storing the raw signature would be inappropriate.
 */
export function redactSignature(intent: SettlementIntent): SettlementIntent {
  const payload = intent.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return intent;
  return {
    ...intent,
    payload: { ...payload, signature: "[redacted]" },
  };
}

/** Options for buildMiddleware beyond routes and strategy */
export type MiddlewareOptions = {
  /** Called with settlement intent data before the settle call fires, for durable recording */
  onSettlementIntent?: OnSettlementIntent;
  /** Wraps the background settlement promise (e.g., Cloudflare Workers ctx.waitUntil) */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Called when the fire-and-forget settlement promise rejects. Default is to
   * log to `console.error`. Provide your own to forward errors to a queue
   * or error tracker — e.g. for retries based on `SettlementIntent`.
   */
  onSettlementError?: (err: unknown, intent: SettlementIntent) => void | Promise<void>;
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
  // Validate every route's price up-front. `parseUsdcAmount` already throws on
  // garbage; we additionally reject empty / zero prices because charging
  // nothing is almost always a config typo, and a misconfigured route silently
  // serving free traffic is a worse failure mode than a startup error.
  for (const [routeKey, routeConfig] of Object.entries(routes)) {
    let parsed: string;
    try {
      parsed = strategy.getPrice(routeConfig);
    } catch (err) {
      throw new Error(`Route ${routeKey}: invalid price — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!parsed || parsed === "0") {
      throw new Error(`Route ${routeKey}: price must be greater than 0 (got "${parsed}")`);
    }
  }

  return async (c, next) => {
    // Derive per-request waitUntil from Hono's executionCtx (Cloudflare Workers),
    // unless an explicit waitUntil was provided at construction time.
    // Accessing c.executionCtx throws in non-Workers runtimes, so we guard with try-catch.
    let perRequestWaitUntil = options?.waitUntil;
    if (!perRequestWaitUntil) {
      try {
        const execCtx = (c as unknown as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx;
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
          // Validate before setting response headers — settlement values
          // come from the facilitator (potentially remote and untrusted in
          // a misconfiguration scenario). A CR/LF or stray header byte
          // would let a malicious facilitator inject arbitrary headers
          // (Set-Cookie, Cache-Control) into our response.
          if (isSafeHeaderValue(settlement.settledAmount) && /^\d+$/.test(settlement.settledAmount)) {
            c.header("X-Payment-Settled", settlement.settledAmount);
          }
          if (isSafeHeaderValue(settlement.payer) && /^0x[a-fA-F0-9]{40}$/.test(settlement.payer)) {
            c.header("X-Payment-Payer", settlement.payer);
          }
        }
        return;
      }
    }
  };
}
