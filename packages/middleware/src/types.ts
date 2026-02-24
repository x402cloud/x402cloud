import type { Network, MeterFunction } from "@x402cloud/protocol";

/** Route config for upto (metered) pricing */
export type UptoRouteConfig = {
  network: Network;
  /** Maximum price per request in USDC (e.g., "$0.10") */
  maxPrice: string;
  /** Minimum price — reject if client authorization is below this */
  minPrice?: string;
  /** Recipient address */
  payTo: string;
  /** USDC token address (defaults to network's USDC) */
  asset?: string;
  /** Max seconds before payment expires (default: 300) */
  maxTimeoutSeconds?: number;
  /** Description shown to client */
  description?: string;
  /** Meter function: compute actual cost after request completes */
  meter: MeterFunction;
};

export type UptoRoutesConfig = Record<string, UptoRouteConfig>;

/** Route config for exact (fixed-price) payments */
export type ExactRouteConfig = {
  network: Network;
  /** Fixed price per request in USDC (e.g., "$0.01") */
  price: string;
  /** Recipient address */
  payTo: string;
  /** USDC token address (defaults to network's USDC) */
  asset?: string;
  /** Max seconds before payment expires (default: 300) */
  maxTimeoutSeconds?: number;
  /** Description shown to client */
  description?: string;
};

export type ExactRoutesConfig = Record<string, ExactRouteConfig>;
