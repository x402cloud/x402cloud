import type { PaymentRequired, PaymentRequirements, ResourceInfo, Network } from "@x402cloud/protocol";
import { parseUsdcAmount } from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES } from "@x402cloud/evm";
import type { UptoRouteConfig, ExactRouteConfig } from "./types.js";

/**
 * Shared helper: build a 402 PaymentRequired response from scheme, network, price, and route metadata.
 * Captures the common structure — upto and exact differ only in scheme and which field holds the price.
 */
function buildPaymentRequiredResponse(
  scheme: "upto" | "exact",
  network: Network,
  priceString: string,
  payTo: string,
  resourceUrl: string,
  asset: string | undefined,
  maxTimeoutSeconds: number | undefined,
  description: string | undefined,
  extra?: Record<string, unknown>,
): PaymentRequired {
  const resolvedAsset = asset ?? DEFAULT_USDC_ADDRESSES[network];
  if (!resolvedAsset) {
    throw new Error(`No USDC address for network ${network}. Provide asset explicitly.`);
  }

  // Both spellings of the price go on the wire: `amount` is what the x402 v2
  // spec names it (so stock clients — @x402/fetch, Cloudflare agents — can read
  // the offer), `maxAmount` is what our own client and EVM package have always
  // read. Same value, so there is nothing to disagree about.
  const amount = parseUsdcAmount(priceString);
  const requirements: PaymentRequirements = {
    scheme,
    network,
    asset: resolvedAsset,
    amount,
    maxAmount: amount,
    payTo,
    maxTimeoutSeconds: maxTimeoutSeconds ?? 300,
    ...(extra ? { extra } : {}),
  };

  const resource: ResourceInfo = {
    url: resourceUrl,
    description,
  };

  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource,
    accepts: [requirements],
  };
}

/**
 * Build a 402 PaymentRequired response from upto route config.
 *
 * `facilitator` is the settlement wallet address, advertised as
 * `extra.facilitator`: the canonical upto proxy witness binds the one address
 * allowed to settle, so clients need it at signing time.
 */
export function buildPaymentRequired(
  routeConfig: UptoRouteConfig,
  resourceUrl: string,
  facilitator: `0x${string}`,
): PaymentRequired {
  return buildPaymentRequiredResponse(
    "upto",
    routeConfig.network,
    routeConfig.maxPrice,
    routeConfig.payTo,
    resourceUrl,
    routeConfig.asset,
    routeConfig.maxTimeoutSeconds,
    routeConfig.description,
    { facilitator },
  );
}

/** Build a 402 PaymentRequired response from exact route config */
export function buildExactPaymentRequired(
  routeConfig: ExactRouteConfig,
  resourceUrl: string,
): PaymentRequired {
  return buildPaymentRequiredResponse(
    "exact",
    routeConfig.network,
    routeConfig.price,
    routeConfig.payTo,
    resourceUrl,
    routeConfig.asset,
    routeConfig.maxTimeoutSeconds,
    routeConfig.description,
  );
}
