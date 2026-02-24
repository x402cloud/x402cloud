export type ModelType = "text" | "embed" | "image";

export type ModelEntry = {
  cfModel: string;      // Cloudflare Workers AI model identifier
  type: ModelType;
  description: string;
};

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

export type ModelKey = keyof typeof MODEL_REGISTRY;

/** Helper: get all model keys of a given type */
export function modelKeysOfType(type: ModelType): string[] {
  return Object.entries(MODEL_REGISTRY)
    .filter(([, entry]) => entry.type === type)
    .map(([key]) => key);
}
