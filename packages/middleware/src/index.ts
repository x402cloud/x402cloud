// Generic payment processing (strategy pattern)
export { processPayment, buildMiddleware, runSettlement, redactSignature } from "./generic-core.js";
export type {
  PaymentStrategy,
  PaymentFlowResult,
  SettlementIntent,
  OnSettlementIntent,
  SettlementOutcome,
  OnSettlementResult,
  MiddlewareOptions,
} from "./generic-core.js";

// Framework-agnostic upto/exact wrappers (backward compatible)
export { processUptoPayment } from "./core.js";
export { processExactPayment } from "./exact-core.js";

// Hono middleware adapters
export { buildUptoMiddleware } from "./core.js";
export { buildExactMiddleware } from "./exact-core.js";
export { uptoPaymentMiddleware, exactPaymentMiddleware } from "./hono.js";
export { remoteUptoPaymentMiddleware, remoteExactPaymentMiddleware } from "./remote.js";

// Resilience
export { createResilientFetch, nextBreakerState } from "./resilience.js";
export type { CircuitBreaker, BreakerEvent } from "./resilience.js";

// Response builders
export { buildPaymentRequired, buildExactPaymentRequired } from "./response.js";

// Margin helpers for marketplace merchant-of-record model
export { applyMargin, computeTake, clampToAuthorized, retailPrice, DEFAULT_MARGIN_BPS } from "./margin.js";

// Types
export type { VerifyFn, SettleFn } from "./core.js";
export type { ExactVerifyFn, ExactSettleFn } from "./exact-core.js";
export type { ResilientFetchConfig } from "./resilience.js";
export type { UptoRouteConfig, UptoRoutesConfig, ExactRouteConfig, ExactRoutesConfig } from "./types.js";
