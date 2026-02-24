import { MODEL_REGISTRY, type ModelType } from "@x402cloud/protocol";

export type { ModelType };

/** Neuron rates per million tokens (input/output) */
export type NeuronRate = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export type ModelConfig = {
  model: string;
  type: ModelType;
  description: string;
  neurons: NeuronRate;
  /** Max price in USDC for upto scheme (worst-case estimate) */
  maxPrice: string;
};

/**
 * Neuron cost: $0.011 per 1,000 neurons = $0.000011 per neuron.
 * Markup: 1.10x actual cost + $0.001 base fee per request.
 *
 * maxPrice assumes worst case:
 *   text:  500 input tokens + 2000 output tokens
 *   embed: 8192 input tokens (max context)
 *   image: 1 generation at 1024x1024, 4 steps
 */
const COST_PER_NEURON = 0.000011;
const MARKUP = 1.10;
const BASE_FEE = 0.001;

/** Calculate max price for a text model given worst-case token counts */
function textMaxPrice(neurons: NeuronRate, inputTokens = 500, outputTokens = 2000): string {
  const inputCost = (inputTokens / 1_000_000) * neurons.inputPerMillion * COST_PER_NEURON;
  const outputCost = (outputTokens / 1_000_000) * neurons.outputPerMillion * COST_PER_NEURON;
  const total = (inputCost + outputCost) * MARKUP + BASE_FEE;
  return `$${total.toFixed(6)}`;
}

/** Calculate max price for embed model */
function embedMaxPrice(neurons: NeuronRate, inputTokens = 8192): string {
  const cost = (inputTokens / 1_000_000) * neurons.inputPerMillion * COST_PER_NEURON;
  const total = cost * MARKUP + BASE_FEE;
  return `$${total.toFixed(6)}`;
}

/** Calculate max price for image model (flat per generation) */
function imageMaxPrice(neuronsPerGen: number): string {
  const cost = neuronsPerGen * COST_PER_NEURON;
  const total = cost * MARKUP + BASE_FEE;
  return `$${total.toFixed(6)}`;
}

const NANO_NEURONS: NeuronRate = { inputPerMillion: 1_542, outputPerMillion: 10_158 };
const FAST_NEURONS: NeuronRate = { inputPerMillion: 24_545, outputPerMillion: 77_273 };
const SMART_NEURONS: NeuronRate = { inputPerMillion: 4_119, outputPerMillion: 34_868 };
const BIG_NEURONS: NeuronRate = { inputPerMillion: 26_668, outputPerMillion: 204_805 };
const THINK_NEURONS: NeuronRate = { inputPerMillion: 45_170, outputPerMillion: 443_756 };
const CODE_NEURONS: NeuronRate = { inputPerMillion: 60_000, outputPerMillion: 90_909 };
const EMBED_NEURONS: NeuronRate = { inputPerMillion: 1_075, outputPerMillion: 0 };
const IMAGE_NEURONS_PER_GEN = 172.8; // per 1024x1024 at 4 steps

/** Build MODELS from the shared registry, adding neurons + pricing on top */
function buildModels(): Record<string, ModelConfig> {
  const neuronMap: Record<string, { neurons: NeuronRate; maxPrice: () => string }> = {
    nano:  { neurons: NANO_NEURONS, maxPrice: () => textMaxPrice(NANO_NEURONS) },
    fast:  { neurons: FAST_NEURONS, maxPrice: () => textMaxPrice(FAST_NEURONS) },
    smart: { neurons: SMART_NEURONS, maxPrice: () => textMaxPrice(SMART_NEURONS) },
    think: { neurons: THINK_NEURONS, maxPrice: () => textMaxPrice(THINK_NEURONS) },
    code:  { neurons: CODE_NEURONS, maxPrice: () => textMaxPrice(CODE_NEURONS) },
    big:   { neurons: BIG_NEURONS, maxPrice: () => textMaxPrice(BIG_NEURONS) },
    embed: { neurons: EMBED_NEURONS, maxPrice: () => embedMaxPrice(EMBED_NEURONS) },
    image: { neurons: { inputPerMillion: 0, outputPerMillion: 0 }, maxPrice: () => imageMaxPrice(IMAGE_NEURONS_PER_GEN) },
  };

  const result: Record<string, ModelConfig> = {};
  for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
    const pricing = neuronMap[key];
    if (!pricing) continue;
    result[key] = {
      model: entry.cfModel,
      type: entry.type,
      description: entry.description,
      neurons: pricing.neurons,
      maxPrice: pricing.maxPrice(),
    };
  }
  return result;
}

export const MODELS: Record<string, ModelConfig> = buildModels();

/** Exported constants for metering */
export { COST_PER_NEURON, MARKUP, BASE_FEE, IMAGE_NEURONS_PER_GEN };

export type ModelKey = keyof typeof MODELS;
