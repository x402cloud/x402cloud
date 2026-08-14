import type { MeterFunction } from "@x402cloud/protocol";
import { retailPrice, DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";
import { maxWholesaleCost, wholesaleForDurationMs } from "./pricing.js";

/**
 * Meter for scrape routes.
 *
 * Strategy: extract `durationMs` from either
 *   (a) the JSON response body (`/page`), or
 *   (b) the `X-Scrape-Duration-Ms` response header (`/screenshot`, binary
 *       body — we cannot peek inside a PNG).
 *
 * Convert to wholesale USDC and apply the marketplace margin via
 * `retailPrice`. If the duration is missing or unparseable, fall back to the
 * maximum wholesale cost — we always charge *something* for the work done.
 *
 * `retailPrice(...)` clamps to the authorized amount, so the on-chain settle
 * can never exceed the agent's signature.
 *
 * @param marginBps Marketplace take rate. Defaults to `DEFAULT_MARGIN_BPS`
 *   from middleware — pass an explicit value to override per route.
 */
export function createMeter(marginBps = DEFAULT_MARGIN_BPS): MeterFunction {
  return async ({ response, authorizedAmount, settlementFee }) => {
    const durationMs = await extractDurationMs(response);

    const wholesale = Number.isFinite(durationMs)
      ? wholesaleForDurationMs(durationMs)
      : maxWholesaleCost();

    // settlementFee rides the /verify response (workspace#45) — see infer's
    // meter.ts for the full rationale. Absent means no floor.
    return retailPrice(wholesale, authorizedAmount, marginBps, settlementFee ?? "0");
  };
}

async function extractDurationMs(response: Response): Promise<number> {
  // Header path: works for binary responses (screenshot PNG) and is also a
  // valid fast path for JSON.
  const headerValue = response.headers.get("X-Scrape-Duration-Ms");
  if (headerValue) {
    const parsed = Number(headerValue);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return Number.NaN;

  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as Record<string, unknown>;
  const raw = body?.durationMs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : Number.NaN;
}
