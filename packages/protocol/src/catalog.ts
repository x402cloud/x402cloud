import type { Network, Scheme } from "./types.js";

/**
 * MarketplaceService — a single tradable agent service in the x402cloud catalog.
 *
 * Catalog entries are pure data: they describe an x402-paid endpoint agents can
 * discover, price-shop, and call without signup. The marketplace operator is the
 * merchant of record — `payment.payTo` is the marketplace wallet, not the
 * upstream provider's. Margin is applied inside each service's `meter` function.
 */
export type MarketplaceService = {
  /** Stable id, kebab-case. e.g. "infer-fast", "sandbox-python", "scrape-page" */
  id: string;
  /** Coarse grouping for discovery filters */
  category: "inference" | "sandbox" | "scraping" | "embedding" | "image" | string;
  /** Human-readable name shown to agents */
  name: string;
  /** One-line description */
  description: string;
  /** HTTP endpoint */
  endpoint: {
    method: "POST" | "GET";
    url: string;
  };
  /** Payment configuration */
  payment: {
    protocol: "x402";
    scheme: Scheme;
    network: Network;
    /** ERC-20 token contract (USDC on the given network) */
    asset: string;
    /** Worst-case ceiling for upto scheme. e.g. "$0.01" */
    maxPrice: string;
    /** Marketplace operator wallet (merchant of record) */
    payTo: string;
    /** Facilitator URL that verifies + settles */
    facilitator: string;
    /**
     * Marketplace take rate in basis points (100 = 1%, 2000 = 20%).
     * Optional — meters default to `DEFAULT_MARGIN_BPS` from `@x402cloud/middleware`.
     * Setting this per service enables category-specific take rates as a data
     * change, not a code change.
     */
    marginBps?: number;
  };
  /** Optional JSON Schemas describing request/response shape */
  schema?: {
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
  };
  /** Free-form tags for search */
  tags: string[];
  /** Concrete usage examples agents can show their operators */
  examples?: Array<{
    description: string;
    request: unknown;
  }>;
};

/** The full marketplace catalog response shape */
export type Catalog = {
  version: string;
  generatedAt: string;
  operator: {
    name: string;
    url: string;
    payTo: string;
  };
  services: MarketplaceService[];
};
