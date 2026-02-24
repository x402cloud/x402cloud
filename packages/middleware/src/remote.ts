import type { MiddlewareHandler } from "hono";
import type { VerifyResponse, PaymentRequirements } from "@x402cloud/protocol";
import type { UptoRoutesConfig, ExactRoutesConfig } from "./types.js";
import { buildUptoMiddleware } from "./core.js";
import { buildExactMiddleware } from "./exact-core.js";
import { createResilientFetch, type ResilientFetchConfig } from "./resilience.js";
import type { MiddlewareOptions } from "./generic-core.js";

/**
 * Shared helper: create a remote verify function that POSTs to the facilitator.
 * Both upto and exact use identical verify HTTP calls.
 */
function createRemoteVerify<TPayload>(
  baseUrl: string,
  resilientFetch: typeof fetch,
): (payload: TPayload, requirements: PaymentRequirements) => Promise<VerifyResponse> {
  return async (payload, requirements) => {
    try {
      const res = await resilientFetch(`${baseUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, requirements }),
      });
      if (!res.ok) {
        return { isValid: false, invalidReason: `facilitator_error_${res.status}` };
      }
      return (await res.json()) as VerifyResponse;
    } catch {
      return { isValid: false, invalidReason: "facilitator_unavailable" };
    }
  };
}

/**
 * Shared helper: create a remote settle function that POSTs to the facilitator.
 * The body shape differs slightly (upto includes settlementAmount, exact does not),
 * so we accept an optional body builder.
 */
function createRemoteSettle<TArgs extends unknown[]>(
  baseUrl: string,
  resilientFetch: typeof fetch,
  buildBody: (...args: TArgs) => object,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    try {
      const res = await resilientFetch(`${baseUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(...args)),
      });
      if (!res.ok) {
        return;
      }
      await res.json();
    } catch (err) {
      console.error("x402 remote settlement failed:", err);
    }
  };
}

/**
 * Hono middleware for x402 upto payments via a remote facilitator API.
 * Use when the server is stateless (e.g., Cloudflare Workers without private keys).
 *
 * Optionally accepts a `ResilientFetchConfig` to tune retry and circuit breaker behavior.
 * By default, retries up to 2 times with exponential backoff on network/5xx errors.
 */
export function remoteUptoPaymentMiddleware(
  routes: UptoRoutesConfig,
  facilitatorUrl: string,
  resilientConfig?: ResilientFetchConfig,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");
  const resilientFetch = createResilientFetch(resilientConfig);

  return buildUptoMiddleware(
    routes,
    createRemoteVerify(baseUrl, resilientFetch),
    createRemoteSettle(baseUrl, resilientFetch, (payload, requirements, settlementAmount) => ({
      payload,
      requirements,
      settlementAmount,
    })),
    options,
  );
}

/**
 * Hono middleware for x402 exact payments via a remote facilitator API.
 * Use when the server is stateless (e.g., Cloudflare Workers without private keys).
 *
 * Optionally accepts a `ResilientFetchConfig` to tune retry and circuit breaker behavior.
 * By default, retries up to 2 times with exponential backoff on network/5xx errors.
 */
export function remoteExactPaymentMiddleware(
  routes: ExactRoutesConfig,
  facilitatorUrl: string,
  resilientConfig?: ResilientFetchConfig,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");
  const resilientFetch = createResilientFetch(resilientConfig);

  return buildExactMiddleware(
    routes,
    createRemoteVerify(baseUrl, resilientFetch),
    createRemoteSettle(baseUrl, resilientFetch, (payload, requirements) => ({
      payload,
      requirements,
    })),
    options,
  );
}
