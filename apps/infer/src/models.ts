import type { ModelType } from "@x402cloud/protocol";
import { INFER_NEURONS, inferEntries, type NeuronRate } from "@x402cloud/manifests";

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
  /**
   * Retail max price (USD string) for upto scheme — worst-case worker estimate.
   * Sourced from `@x402cloud/manifests` so the marketplace catalog and the
   * Worker route table can never drift.
   */
  maxPrice: string;
};

/**
 * Build MODELS from the registry, pairing each model with its neuron rate
 * (for the meter) and its retail maxPrice (from the manifest). The manifest's
 * `inferEntries(...)` is the single source of truth for the retail dollar
 * string; the parameters below are stable placeholders — only `baseUrl` and
 * margin affect the maxPrice output, and we want the *default* margin since
 * apps/infer's middleware also defaults to it.
 */
function buildModels(): Record<string, ModelConfig> {
  const entries = inferEntries({
    network: "eip155:84532",
    asset: "0x0000000000000000000000000000000000000000",
    payTo: "0x0000000000000000000000000000000000000000",
    facilitator: "https://facilitator.x402cloud.ai",
    baseUrl: "https://infer.x402cloud.ai",
  });
  const priceByKey = new Map(entries.map((e) => [e.path.slice(1), e.maxPrice]));

  const result: Record<string, ModelConfig> = {};
  for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
    const neurons = INFER_NEURONS[key];
    const maxPrice = priceByKey.get(key);
    if (!neurons || !maxPrice) continue;
    result[key] = {
      model: entry.cfModel,
      type: entry.type,
      description: entry.description,
      neurons,
      maxPrice,
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
