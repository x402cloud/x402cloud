import type { MarketplaceService, Network } from "@x402cloud/protocol";
import { DEFAULT_USDC_ADDRESSES } from "@x402cloud/evm";
import {
  inferManifest,
  sandboxManifest,
  scrapeManifest,
} from "@x402cloud/manifests";

/**
 * Build the live catalog given the network + operator config.
 *
 * Service entries are NOT declared here — each service owns its own
 * manifest in `@x402cloud/manifests` (the same module the service
 * Worker reads to build its route table). That guarantees the catalog
 * price and the Worker's `maxPrice` can never drift.
 *
 * Adding a service is two steps: add a manifest file in `packages/manifests`
 * and add its builder to the assembler below.
 *
 * The marketplace operator's wallet (OPERATOR_ADDRESS) is always the
 * merchant of record — `payTo` is never the upstream provider.
 */

export type CatalogParams = {
  network: Network;
  operatorAddress: string;
  facilitator: string;
  /** Override per-environment service hostnames (e.g. for staging/local dev) */
  hosts?: {
    infer?: string;
    sandbox?: string;
    scrape?: string;
  };
};

const DEFAULT_HOSTS = {
  infer:   "https://infer.x402cloud.ai",
  sandbox: "https://sandbox.x402cloud.ai",
  scrape:  "https://scrape.x402cloud.ai",
} as const;

export function buildCatalog(p: CatalogParams): MarketplaceService[] {
  const asset = DEFAULT_USDC_ADDRESSES[p.network];
  if (!asset) throw new Error(`No USDC address for network ${p.network}`);

  const inferHost   = p.hosts?.infer   ?? DEFAULT_HOSTS.infer;
  const sandboxHost = p.hosts?.sandbox ?? DEFAULT_HOSTS.sandbox;
  const scrapeHost  = p.hosts?.scrape  ?? DEFAULT_HOSTS.scrape;

  const common = {
    network: p.network,
    asset,
    payTo: p.operatorAddress,
    facilitator: p.facilitator,
  };

  return [
    ...inferManifest({   ...common, baseUrl: inferHost }),
    ...sandboxManifest({ ...common, baseUrl: sandboxHost }),
    ...scrapeManifest({  ...common, baseUrl: scrapeHost }),
  ];
}
