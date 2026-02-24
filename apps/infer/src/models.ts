import type { ModelType } from "@x402cloud/protocol";
import {
  computeTextCost,
  computeEmbedCost,
  computeImageCost,
  IMAGE_NEURONS_PER_GEN,
  type NeuronRate,
} from "./pricing.js";

export type { ModelType, NeuronRate };

export type ModelEntry = {
  cfModel: string;
  type: ModelType;
  description: string;
};

/** Cloudflare Workers AI model registry — app-level data, not protocol */
export const MODEL_REGISTRY: Readonly<Record<string, ModelEntry>> = Object.freeze({
  nano:  { cfModel: "@cf/ibm-granite/granite-4.0-h-micro", type: "text", description: "Fastest, simple tasks" },
  fast:  { cfModel: "@cf/meta/llama-4-scout-17b-16e-instruct", type: "text", description: "Quick and capable" },
  smart: { cfModel: "@cf/meta/llama-3.1-8b-instruct-fast", type: "text", description: "Reliable workhorse" },
  think: { cfModel: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", type: "text", description: "Deep reasoning" },
  code:  { cfModel: "@cf/qwen/qwen2.5-coder-32b-instruct", type: "text", description: "Code specialist" },
  big:   { cfModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", type: "text", description: "Highest quality" },
  embed: { cfModel: "@cf/baai/bge-m3", type: "embed", description: "Text embeddings" },
  image: { cfModel: "@cf/black-forest-labs/flux-1-schnell", type: "image", description: "Image generation" },
});

export type ModelConfig = {
  model: string;
  type: ModelType;
  description: string;
  neurons: NeuronRate;
  /** Max price in USDC for upto scheme (worst-case estimate) */
  maxPrice: string;
};

/**
 * maxPrice assumes worst case:
 *   text:  500 input tokens + 2000 output tokens
 *   embed: 8192 input tokens (max context)
 *   image: 1 generation at 1024x1024, 4 steps
 */

/** Format a cost as a dollar string for maxPrice */
function textMaxPrice(neurons: NeuronRate, inputTokens = 500, outputTokens = 2000): string {
  return `$${computeTextCost(neurons, inputTokens, outputTokens).toFixed(6)}`;
}

function embedMaxPrice(neurons: NeuronRate, inputTokens = 8192): string {
  return `$${computeEmbedCost(neurons, inputTokens).toFixed(6)}`;
}

function imageMaxPrice(neuronsPerGen: number): string {
  return `$${computeImageCost(neuronsPerGen).toFixed(6)}`;
}

const NANO_NEURONS: NeuronRate = { inputPerMillion: 1_542, outputPerMillion: 10_158 };
const FAST_NEURONS: NeuronRate = { inputPerMillion: 24_545, outputPerMillion: 77_273 };
const SMART_NEURONS: NeuronRate = { inputPerMillion: 4_119, outputPerMillion: 34_868 };
const BIG_NEURONS: NeuronRate = { inputPerMillion: 26_668, outputPerMillion: 204_805 };
const THINK_NEURONS: NeuronRate = { inputPerMillion: 45_170, outputPerMillion: 443_756 };
const CODE_NEURONS: NeuronRate = { inputPerMillion: 60_000, outputPerMillion: 90_909 };
const EMBED_NEURONS: NeuronRate = { inputPerMillion: 1_075, outputPerMillion: 0 };

/** Build MODELS from the registry, adding neurons + pricing on top */
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

/** Helper: get all model keys of a given type */
export function modelKeysOfType(type: ModelType): string[] {
  return Object.entries(MODEL_REGISTRY)
    .filter(([, entry]) => entry.type === type)
    .map(([key]) => key);
}

export type ModelKey = keyof typeof MODELS;
