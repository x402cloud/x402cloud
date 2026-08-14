import type { Network } from "@x402cloud/protocol";

/**
 * Inputs every manifest builder needs to produce catalog entries +
 * route-table data. These are the **environmental** values — they vary by
 * deployment (network, operator wallet, facilitator URL, the service's own
 * public host) but the *prices* are derived from each manifest module's
 * own wholesale-cost math.
 */
export type ManifestParams = {
  network: Network;
  /** USDC contract on this network */
  asset: string;
  /** Operator wallet (merchant of record — payTo on every entry) */
  payTo: string;
  /** Facilitator URL that verifies + settles */
  facilitator: string;
  /** Public base URL of this service, e.g. "https://infer.x402cloud.ai" */
  baseUrl: string;
  /** Optional override of the marketplace margin (basis points) per service */
  marginBps?: number;
  /**
   * Settlement-fee floor (USDC smallest units, decimal string) to bake into
   * `maxPrice` so the 402 ceiling has headroom for it (workspace#45). Defaults
   * to `"0"` — the current testnet deployment settles for free, so there is
   * no floor to reserve room for. A mainnet deployment should pass the
   * facilitator's current `/fee` quote here at manifest-build time.
   */
  feeFloorMicro?: string;
};

/**
 * Lightweight per-route record used by a service Worker to build its
 * own route table without re-declaring prices.
 *
 *   path     — the path on the service ("/fast")
 *   id       — the globally unique catalog id ("infer-fast")
 *   maxPrice — the worst-case retail USD display string ("$0.002202")
 */
export type ServiceManifestEntry = {
  path: string;
  id: string;
  maxPrice: string;
};
