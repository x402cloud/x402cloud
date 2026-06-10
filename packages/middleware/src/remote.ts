import type { MiddlewareHandler } from "hono";
import type { VerifyResponse, SettleResponse, PaymentRequirements } from "@x402cloud/protocol";
import type { UptoRoutesConfig, ExactRoutesConfig } from "./types.js";
import { buildUptoMiddleware } from "./core.js";
import { buildExactMiddleware } from "./exact-core.js";
import { createResilientFetch, type ResilientFetchConfig } from "./resilience.js";
import type { MiddlewareOptions } from "./generic-core.js";

/**
 * Shared helper: create a remote verify function that POSTs to a facilitator
 * endpoint. The `path` differs by scheme (`/verify` vs `/verify-exact`).
 */
function createRemoteVerify<TPayload>(
  baseUrl: string,
  path: string,
  resilientFetch: typeof fetch,
): (payload: TPayload, requirements: PaymentRequirements) => Promise<VerifyResponse> {
  return async (payload, requirements) => {
    try {
      const res = await resilientFetch(`${baseUrl}${path}`, {
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
 * Shared helper: create a remote settle function that POSTs to a facilitator
 * endpoint. The `path` differs by scheme (`/settle` vs `/settle-exact`) and the
 * body shape differs (upto includes settlementAmount), so we accept a body builder.
 *
 * Returns the facilitator's `SettleResponse` so the caller can record the
 * outcome. Every failure mode — non-2xx, unreachable facilitator, an open
 * circuit breaker, or an on-chain `{success:false}` — is mapped to a definite
 * failure result rather than silently dropped. A delivered service whose
 * settlement we cannot confirm is a reconciliation obligation, not a no-op.
 */
function createRemoteSettle<TArgs extends unknown[]>(
  baseUrl: string,
  path: string,
  resilientFetch: typeof fetch,
  buildBody: (...args: TArgs) => object,
): (...args: TArgs) => Promise<SettleResponse> {
  return async (...args) => {
    let res: Response;
    try {
      res = await resilientFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(...args)),
      });
    } catch (err) {
      return {
        success: false,
        errorReason: `facilitator_unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!res.ok) {
      return { success: false, errorReason: `facilitator_http_${res.status}` };
    }
    try {
      return (await res.json()) as SettleResponse;
    } catch (err) {
      return {
        success: false,
        errorReason: `facilitator_bad_response: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

/**
 * Hono middleware for x402 upto payments via a remote facilitator API.
 * Use when the server is stateless (e.g., Cloudflare Workers without private keys).
 *
 * Optionally accepts a `ResilientFetchConfig` to tune retry and circuit breaker behavior.
 * By default, retries up to 2 times with exponential backoff on network/5xx errors.
 *
 * `facilitatorAddress` is the remote facilitator's settlement wallet address
 * (shown at its `/supported` endpoint). It is advertised to clients in the
 * 402 response (`extra.facilitator`) because the canonical upto proxy witness
 * binds the one address allowed to settle. Explicit config injection — no
 * hidden fetches.
 */
export function remoteUptoPaymentMiddleware(
  routes: UptoRoutesConfig,
  facilitatorUrl: string,
  facilitatorAddress: `0x${string}`,
  resilientConfig?: ResilientFetchConfig,
  options?: MiddlewareOptions,
): MiddlewareHandler {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");
  const resilientFetch = createResilientFetch(resilientConfig);

  return buildUptoMiddleware(
    routes,
    createRemoteVerify(baseUrl, "/verify", resilientFetch),
    createRemoteSettle(baseUrl, "/settle", resilientFetch, (payload, requirements, settlementAmount) => ({
      payload,
      requirements,
      settlementAmount,
    })),
    facilitatorAddress,
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
    createRemoteVerify(baseUrl, "/verify-exact", resilientFetch),
    createRemoteSettle(baseUrl, "/settle-exact", resilientFetch, (payload, requirements) => ({
      payload,
      requirements,
    })),
    options,
  );
}
