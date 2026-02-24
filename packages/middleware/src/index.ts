// Framework-agnostic payment processing (use these for non-Hono frameworks)
export { processUptoPayment } from "./core.js";
export { processExactPayment } from "./exact-core.js";
export type { PaymentFlowResult } from "./core.js";

// Hono middleware adapters
export { buildUptoMiddleware } from "./core.js";
export { buildExactMiddleware } from "./exact-core.js";
export { uptoPaymentMiddleware, exactPaymentMiddleware } from "./hono.js";
export { remoteUptoPaymentMiddleware, remoteExactPaymentMiddleware } from "./remote.js";

// Resilience
export { createResilientFetch } from "./resilience.js";

// Response builders
export { buildPaymentRequired, buildExactPaymentRequired } from "./response.js";

// Types
export type { VerifyFn, SettleFn } from "./core.js";
export type { ExactVerifyFn, ExactSettleFn } from "./exact-core.js";
export type { ResilientFetchConfig } from "./resilience.js";
export type { UptoRouteConfig, UptoRoutesConfig, ExactRouteConfig, ExactRoutesConfig } from "./types.js";
