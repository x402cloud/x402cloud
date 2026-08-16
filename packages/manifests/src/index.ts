export { inferManifest, inferEntries, INFER_NEURONS } from "./infer.js";
export { sandboxManifest, sandboxEntries } from "./sandbox.js";
export { scrapeManifest, scrapeEntries } from "./scrape.js";
export type { ManifestParams, ServiceManifestEntry } from "./types.js";

// Re-export wholesale pricing helpers so apps can drop their local pricing
// modules and import directly from manifests. The per-service pricing
// namespaces avoid name collisions between sandbox/scrape `maxWholesaleCost`.
export {
  MICRO_USDC_PER_NEURON,
  IMAGE_NEURONS_PER_GEN,
  IMAGE_NEURONS_PER_GEN_SCALED_10,
  QUOTE_INPUT_TOKENS,
  QUOTE_OUTPUT_TOKENS,
  QUOTE_EMBED_TOKENS,
  wholesaleTextCost,
  wholesaleEmbedCost,
  wholesaleImageCost,
  type NeuronRate,
} from "./infer-pricing.js";

export * as sandboxPricing from "./sandbox-pricing.js";
export * as scrapePricing from "./scrape-pricing.js";

export { retailDisplay, microToUsdDisplay } from "./format.js";
