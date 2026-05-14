/**
 * Wholesale pricing for the infer service.
 *
 * The actual implementation lives in `@x402cloud/manifests` so the
 * marketplace catalog and this app share one source of truth. This module
 * re-exports the helpers so existing `meter.ts` / tests can keep importing
 * `./pricing.js` unchanged.
 */
export {
  MICRO_USDC_PER_NEURON,
  IMAGE_NEURONS_PER_GEN,
  IMAGE_NEURONS_PER_GEN_SCALED_10,
  wholesaleTextCost,
  wholesaleEmbedCost,
  wholesaleImageCost,
  type NeuronRate,
} from "@x402cloud/manifests";
