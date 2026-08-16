import type { PaymentRequired, PaymentRequirements, ResourceInfo, Network } from "@x402cloud/protocol";
import { parseUsdcAmount } from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES } from "@x402cloud/evm";
import type { UptoRouteConfig, ExactRouteConfig } from "./types.js";

/** Everything a `PaymentRequirements` needs, before defaults are applied. */
export type RequirementsSpec = {
  scheme: "upto" | "exact";
  network: Network;
  /** Price in the asset's smallest units — already parsed, not a "$0.01" string. */
  amount: string;
  payTo: string;
  asset?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

/**
 * THE constructor for `PaymentRequirements`. One concept, one place: the 402 we
 * advertise and the requirements we verify against are built by this function,
 * so they cannot drift apart and a new spec field is one edit, not two.
 *
 * Throws when the network has no default asset and none was given — a route
 * that cannot name its token is a misconfiguration, not a runtime condition.
 */
export function buildRequirements(spec: RequirementsSpec): PaymentRequirements {
  const asset = spec.asset ?? DEFAULT_USDC_ADDRESSES[spec.network];
  if (!asset) {
    throw new Error(`No USDC address for network ${spec.network}. Provide asset explicitly.`);
  }

  return {
    scheme: spec.scheme,
    network: spec.network,
    asset,
    amount: spec.amount,
    payTo: spec.payTo,
    maxTimeoutSeconds: spec.maxTimeoutSeconds ?? 300,
    ...(spec.extra ? { extra: spec.extra } : {}),
  };
}

/**
 * Shared helper: build a 402 PaymentRequired envelope around one offer.
 *
 * `error` is the spec's optional human-readable reason. It is a PARAMETER, not
 * a constant: this builder is public API and has no idea why the caller is
 * returning a 402 — "no header" and "verification failed" are different facts
 * and each call site knows which one it holds.
 */
function buildPaymentRequiredResponse(
  spec: RequirementsSpec,
  resourceUrl: string,
  description: string | undefined,
  error: string | undefined,
): PaymentRequired {
  const resource: ResourceInfo = {
    url: resourceUrl,
    description,
  };

  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource,
    accepts: [buildRequirements(spec)],
  };
}

/**
 * Build a 402 PaymentRequired response from upto route config.
 *
 * `facilitator` is the settlement wallet address, advertised as
 * `extra.facilitator`: the canonical upto proxy witness binds the one address
 * allowed to settle, so clients need it at signing time.
 *
 * `error` is optional and omitted when not supplied — pass the reason this
 * particular 402 is being returned.
 */
export function buildPaymentRequired(
  routeConfig: UptoRouteConfig,
  resourceUrl: string,
  facilitator: `0x${string}`,
  error?: string,
): PaymentRequired {
  return buildPaymentRequiredResponse(
    {
      scheme: "upto",
      network: routeConfig.network,
      amount: parseUsdcAmount(routeConfig.maxPrice),
      payTo: routeConfig.payTo,
      asset: routeConfig.asset,
      maxTimeoutSeconds: routeConfig.maxTimeoutSeconds,
      extra: { facilitator },
    },
    resourceUrl,
    routeConfig.description,
    error,
  );
}

/** Build a 402 PaymentRequired response from exact route config */
export function buildExactPaymentRequired(
  routeConfig: ExactRouteConfig,
  resourceUrl: string,
  error?: string,
): PaymentRequired {
  return buildPaymentRequiredResponse(
    {
      scheme: "exact",
      network: routeConfig.network,
      amount: parseUsdcAmount(routeConfig.price),
      payTo: routeConfig.payTo,
      asset: routeConfig.asset,
      maxTimeoutSeconds: routeConfig.maxTimeoutSeconds,
    },
    resourceUrl,
    routeConfig.description,
    error,
  );
}
