/** Neuron rates per million tokens (input/output) */
export type NeuronRate = {
  inputPerMillion: number;
  outputPerMillion: number;
};

/**
 * Neuron cost: $0.011 per 1,000 neurons = $0.000011 per neuron.
 * Markup: 1.10x actual cost + $0.001 base fee per request.
 */
export const COST_PER_NEURON = 0.000011;
export const MARKUP = 1.10;
export const BASE_FEE = 0.001;
export const IMAGE_NEURONS_PER_GEN = 172.8; // per 1024x1024 at 4 steps

/** Compute USDC cost for a text model given neuron rates and token counts */
export function computeTextCost(neurons: NeuronRate, inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * neurons.inputPerMillion * COST_PER_NEURON;
  const outputCost = (outputTokens / 1_000_000) * neurons.outputPerMillion * COST_PER_NEURON;
  return (inputCost + outputCost) * MARKUP + BASE_FEE;
}

/** Compute USDC cost for an embed model given neuron rates and input token count */
export function computeEmbedCost(neurons: NeuronRate, inputTokens: number): number {
  const cost = (inputTokens / 1_000_000) * neurons.inputPerMillion * COST_PER_NEURON;
  return cost * MARKUP + BASE_FEE;
}

/** Compute USDC cost for image generation (flat per generation) */
export function computeImageCost(neuronsPerGen: number = IMAGE_NEURONS_PER_GEN): number {
  const cost = neuronsPerGen * COST_PER_NEURON;
  return cost * MARKUP + BASE_FEE;
}
