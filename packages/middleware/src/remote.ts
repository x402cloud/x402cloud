import type { MiddlewareHandler } from "hono";
import type { VerifyResponse, SettleResponse } from "@x402cloud/protocol";
import type { UptoRoutesConfig } from "./types.js";
import { buildUptoMiddleware } from "./core.js";

/**
 * Hono middleware for x402 upto payments via a remote facilitator API.
 * Use when the server is stateless (e.g., Cloudflare Workers without private keys).
 */
export function remoteUptoPaymentMiddleware(
  routes: UptoRoutesConfig,
  facilitatorUrl: string,
): MiddlewareHandler {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");

  return buildUptoMiddleware(
    routes,
    async (payload, requirements) => {
      const res = await fetch(`${baseUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, requirements }),
      });
      if (!res.ok) {
        return { isValid: false, invalidReason: `facilitator_error_${res.status}` };
      }
      return (await res.json()) as VerifyResponse;
    },
    async (payload, requirements, settlementAmount) => {
      const res = await fetch(`${baseUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, requirements, settlementAmount }),
      });
      if (!res.ok) {
        return;
      }
      await res.json();
    },
  );
}
