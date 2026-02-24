import type { MiddlewareHandler } from "hono";
import type { VerifyResponse } from "@x402cloud/protocol";
import type { UptoRoutesConfig, ExactRoutesConfig } from "./types.js";
import { buildUptoMiddleware } from "./core.js";
import { buildExactMiddleware } from "./exact-core.js";
import { createResilientFetch, type ResilientFetchConfig } from "./resilience.js";

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
): MiddlewareHandler {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");
  const resilientFetch = createResilientFetch(resilientConfig);

  return buildUptoMiddleware(
    routes,
    async (payload, requirements) => {
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
    },
    async (payload, requirements, settlementAmount) => {
      try {
        const res = await resilientFetch(`${baseUrl}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload, requirements, settlementAmount }),
        });
        if (!res.ok) {
          return;
        }
        await res.json();
      } catch {
        // Settlement is fire-and-forget; swallow errors after retries exhausted
      }
    },
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
): MiddlewareHandler {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");
  const resilientFetch = createResilientFetch(resilientConfig);

  return buildExactMiddleware(
    routes,
    async (payload, requirements) => {
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
    },
    async (payload, requirements) => {
      try {
        const res = await resilientFetch(`${baseUrl}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload, requirements }),
        });
        if (!res.ok) {
          return;
        }
        await res.json();
      } catch {
        // Settlement is fire-and-forget; swallow errors after retries exhausted
      }
    },
  );
}
