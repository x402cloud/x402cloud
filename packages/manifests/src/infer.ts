import type { MarketplaceService } from "@x402cloud/protocol";
import { DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";
import { retailDisplay } from "./format.js";
import {
  wholesaleTextCost,
  wholesaleEmbedCost,
  wholesaleImageCost,
  IMAGE_NEURONS_PER_GEN,
  type NeuronRate,
} from "./infer-pricing.js";
import type { ManifestParams, ServiceManifestEntry } from "./types.js";

/**
 * Neuron rates per model — measured wholesale Workers AI cost. Adding a model
 * is a row, not a code change.
 */
const NANO_NEURONS: NeuronRate = { inputPerMillion: 1_542, outputPerMillion: 10_158 };
const FAST_NEURONS: NeuronRate = { inputPerMillion: 24_545, outputPerMillion: 77_273 };
const SMART_NEURONS: NeuronRate = { inputPerMillion: 4_119, outputPerMillion: 34_868 };
const BIG_NEURONS: NeuronRate = { inputPerMillion: 26_668, outputPerMillion: 204_805 };
const THINK_NEURONS: NeuronRate = { inputPerMillion: 45_170, outputPerMillion: 443_756 };
const CODE_NEURONS: NeuronRate = { inputPerMillion: 60_000, outputPerMillion: 90_909 };
const EMBED_NEURONS: NeuronRate = { inputPerMillion: 1_075, outputPerMillion: 0 };

export const INFER_NEURONS: Readonly<Record<string, NeuronRate>> = Object.freeze({
  nano: NANO_NEURONS,
  fast: FAST_NEURONS,
  smart: SMART_NEURONS,
  think: THINK_NEURONS,
  code: CODE_NEURONS,
  big: BIG_NEURONS,
  embed: EMBED_NEURONS,
  image: { inputPerMillion: 0, outputPerMillion: 0 },
});

type InferModelKind = "text" | "embed" | "image";

type InferRow = {
  /** Route path on the service (without leading slash) */
  key: string;
  /** Catalog id, globally unique */
  id: string;
  category: MarketplaceService["category"];
  kind: InferModelKind;
  name: string;
  description: string;
  tags: string[];
  examples?: MarketplaceService["examples"];
};

/**
 * Worst-case assumptions for maxPrice:
 *   text:  500 input tokens + 2000 output tokens
 *   embed: 8192 input tokens (max context)
 *   image: 1 generation at 1024x1024, 4 steps
 */
function maxPriceFor(row: InferRow, marginBps: number, feeFloorMicro: string): string {
  const neurons = INFER_NEURONS[row.key];
  if (!neurons) throw new Error(`No neuron rate for infer model: ${row.key}`);
  if (row.kind === "image") {
    return retailDisplay(wholesaleImageCost(IMAGE_NEURONS_PER_GEN), marginBps, feeFloorMicro);
  }
  if (row.kind === "embed") {
    return retailDisplay(wholesaleEmbedCost(neurons, 8192), marginBps, feeFloorMicro);
  }
  return retailDisplay(wholesaleTextCost(neurons, 500, 2000), marginBps, feeFloorMicro);
}

const INFER_ROWS: ReadonlyArray<InferRow> = Object.freeze([
  {
    key: "nano",
    id: "infer-nano",
    category: "inference",
    kind: "text",
    name: "Nano LLM",
    description: "Granite 4.0 H Micro — fastest, simple tasks",
    tags: ["llm", "chat", "openai-compatible", "granite"],
  },
  {
    key: "fast",
    id: "infer-fast",
    category: "inference",
    kind: "text",
    name: "Fast LLM",
    description: "Llama 4 Scout 17B — quick, capable chat completions",
    tags: ["llm", "chat", "openai-compatible", "llama"],
    examples: [{
      description: "Simple chat completion",
      request: { messages: [{ role: "user", content: "Hello" }] },
    }],
  },
  {
    key: "smart",
    id: "infer-smart",
    category: "inference",
    kind: "text",
    name: "Smart LLM",
    description: "Llama 3.1 8B — reliable workhorse for general tasks",
    tags: ["llm", "chat", "openai-compatible", "llama"],
  },
  {
    key: "think",
    id: "infer-think",
    category: "inference",
    kind: "text",
    name: "Reasoning LLM",
    description: "DeepSeek R1 distilled 32B — chain-of-thought reasoning",
    tags: ["llm", "reasoning", "openai-compatible", "deepseek"],
  },
  {
    key: "code",
    id: "infer-code",
    category: "inference",
    kind: "text",
    name: "Code LLM",
    description: "Qwen 2.5 Coder 32B — code generation and review",
    tags: ["llm", "code", "openai-compatible", "qwen"],
  },
  {
    key: "big",
    id: "infer-big",
    category: "inference",
    kind: "text",
    name: "Big LLM",
    description: "Llama 3.3 70B — highest quality completions",
    tags: ["llm", "chat", "openai-compatible", "llama"],
  },
  {
    key: "embed",
    id: "infer-embed",
    category: "embedding",
    kind: "embed",
    name: "Text Embeddings",
    description: "BGE-M3 — multilingual text embeddings",
    tags: ["embedding", "bge", "openai-compatible"],
  },
  {
    key: "image",
    id: "infer-image",
    category: "image",
    kind: "image",
    name: "Image Generation",
    description: "Flux Schnell — fast text-to-image, 1024x1024 PNG",
    tags: ["image", "flux", "text-to-image"],
  },
]);

/** Marketplace catalog entries for apps/infer. */
export function inferManifest(p: ManifestParams): MarketplaceService[] {
  const marginBps = p.marginBps ?? DEFAULT_MARGIN_BPS;
  const feeFloorMicro = p.feeFloorMicro ?? "0";
  return INFER_ROWS.map((row) => ({
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    endpoint: { method: "POST" as const, url: `${p.baseUrl}/${row.key}` },
    payment: {
      protocol: "x402" as const,
      scheme: "upto" as const,
      network: p.network,
      asset: p.asset,
      payTo: p.payTo,
      facilitator: p.facilitator,
      maxPrice: maxPriceFor(row, marginBps, feeFloorMicro),
      ...(p.marginBps !== undefined ? { marginBps: p.marginBps } : {}),
    },
    tags: row.tags,
    ...(row.examples ? { examples: row.examples } : {}),
  }));
}

/** Lightweight entries the Worker consumes to build its route table. */
export function inferEntries(p: ManifestParams): ServiceManifestEntry[] {
  const marginBps = p.marginBps ?? DEFAULT_MARGIN_BPS;
  const feeFloorMicro = p.feeFloorMicro ?? "0";
  return INFER_ROWS.map((row) => ({
    path: `/${row.key}`,
    id: row.id,
    maxPrice: maxPriceFor(row, marginBps, feeFloorMicro),
  }));
}
