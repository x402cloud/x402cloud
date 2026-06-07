import type { MeterFunction } from "@x402cloud/protocol";
import { retailPrice, DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";
import { maxWholesaleCost, wholesaleForDurationMs } from "./pricing.js";

/**
 * Meter for sandbox routes.
 *
 * Strategy: read `durationMs` from the response body, convert to wholesale
 * USDC, then apply the marketplace margin via `retailPrice`. If the response
 * body is missing or unparseable, fall back to the maximum wholesale cost —
 * we always charge *something* for the work done, never zero on a malformed
 * reply.
 *
 * `retailPrice(...)` also clamps to the authorized amount, so the on-chain
 * settle can never exceed the agent's signature.
 *
 * @param marginBps Marketplace take rate. Defaults to `DEFAULT_MARGIN_BPS`
 *   from middleware — pass an explicit value to override per route.
 */
export function createMeter(marginBps = DEFAULT_MARGIN_BPS): MeterFunction {
  return async ({ response, authorizedAmount }) => {
    const body = (await response
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;

    const raw = body?.durationMs;
    const durationMs = typeof raw === "number" && Number.isFinite(raw) ? raw : NaN;

    const wholesale = Number.isFinite(durationMs)
      ? wholesaleForDurationMs(durationMs)
      : maxWholesaleCost();

    return retailPrice(wholesale, authorizedAmount, marginBps);
  };
}
