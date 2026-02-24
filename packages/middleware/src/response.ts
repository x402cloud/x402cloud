import type { PaymentRequired, PaymentRequirements, ResourceInfo } from "@x402cloud/protocol";
import { parseUsdcAmount } from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES } from "@x402cloud/evm";
import type { UptoRouteConfig } from "./types.js";

/** Build a 402 PaymentRequired response from route config */
export function buildPaymentRequired(
  routeConfig: UptoRouteConfig,
  resourceUrl: string,
): PaymentRequired {
  const asset = routeConfig.asset ?? DEFAULT_USDC_ADDRESSES[routeConfig.network];
  if (!asset) {
    throw new Error(`No USDC address for network ${routeConfig.network}. Provide asset explicitly.`);
  }

  const requirements: PaymentRequirements = {
    scheme: "upto",
    network: routeConfig.network,
    asset,
    maxAmount: parseUsdcAmount(routeConfig.maxPrice),
    payTo: routeConfig.payTo,
    maxTimeoutSeconds: routeConfig.maxTimeoutSeconds ?? 300,
  };

  const resource: ResourceInfo = {
    url: resourceUrl,
    description: routeConfig.description,
  };

  return {
    x402Version: 2,
    resource,
    accepts: [requirements],
  };
}
