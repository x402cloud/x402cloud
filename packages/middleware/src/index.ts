// Generic payment processing (strategy pattern)
export { processPayment, buildMiddleware } from "./generic-core.js";
export type { PaymentStrategy, PaymentFlowResult, SettlementIntent, OnSettlementIntent, MiddlewareOptions } from "./generic-core.js";

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

// Types
export type { VerifyFn, SettleFn } from "./core.js";
export type { ExactVerifyFn, ExactSettleFn } from "./exact-core.js";
export type { ResilientFetchConfig } from "./resilience.js";
export type { UptoRouteConfig, UptoRoutesConfig, ExactRouteConfig, ExactRoutesConfig } from "./types.js";
