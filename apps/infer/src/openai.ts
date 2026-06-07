/**
 * OpenAI-compatible surface for infer.x402cloud.ai.
 *
 * The service advertises "change base_url and it works". That promise is only
 * true if the standard OpenAI paths actually exist and are *paid* exactly like
 * the underlying model. This module is the data that makes the claim honest:
 *
 *   - `MODEL_ALIASES`: a data map from OpenAI-style names AND the short names
 *     ("fast", "smart", ...) to an internal `MODELS` key. Adding an alias is one
 *     entry — accretion, not branching.
 *   - `OPENAI_ENDPOINTS`: the fixed OpenAI paths, each declaring its kind and the
 *     candidate model keys it may route to (so its 402 quote and meter are built
 *     from real model data, never a free bypass).
 *
 * Resolution is pure: `resolveModel(body, endpoint)` maps the request body's
 * `model` field (or the endpoint default) to an internal model key. The Worker
 * (`index.ts`) wires these into the SAME payment middleware and the SAME
 * handlers — no duplicated inference logic.
 */
import { parseUsdcAmount } from "@x402cloud/protocol";
import { MODELS, modelKeysOfType } from "./models.js";

/**
 * Alias map: external model name -> internal MODELS key.
 *
 * Keys are matched case-insensitively. Covers common OpenAI-style names and the
 * service's own short names so an off-the-shelf OpenAI client "just works", and
 * so `model: "fast"` keeps working too. An unknown name falls back to the
 * endpoint's default — we never 404 a standard client mid-stream.
 */
export const MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  // Short names (identity — keeps existing callers working through /v1)
  nano: "nano",
  fast: "fast",
  smart: "smart",
  think: "think",
  code: "code",
  big: "big",
  embed: "embed",
  image: "image",

  // OpenAI chat model names
  "gpt-3.5-turbo": "fast",
  "gpt-4": "big",
  "gpt-4-turbo": "big",
  "gpt-4o": "big",
  "gpt-4o-mini": "fast",
  "o1": "think",
  "o1-mini": "think",
  "o3-mini": "think",

  // OpenAI embedding model names
  "text-embedding-3-small": "embed",
  "text-embedding-3-large": "embed",
  "text-embedding-ada-002": "embed",

  // OpenAI image model names
  "dall-e-2": "image",
  "dall-e-3": "image",
  "gpt-image-1": "image",
});

export type EndpointKind = "text" | "embed" | "image";

export type OpenAIEndpoint = {
  /** OpenAI-compatible path, e.g. "/v1/chat/completions" */
  path: string;
  /** The inference kind this path serves */
  kind: EndpointKind;
  /** Internal model key used when the body names no (or an unknown) model */
  defaultModel: string;
};

/**
 * The OpenAI-compatible POST surface. Each entry is a fixed path that maps onto
 * an inference kind; the actual model is resolved per request from the body.
 *
 * `defaultModel` is derived from the registry (first model of that kind) so the
 * defaults can never name a model that doesn't exist.
 */
export const OPENAI_ENDPOINTS: readonly OpenAIEndpoint[] = Object.freeze([
  { path: "/v1/chat/completions", kind: "text", defaultModel: modelKeysOfType("text")[0] ?? "fast" },
  { path: "/v1/embeddings", kind: "embed", defaultModel: modelKeysOfType("embed")[0] ?? "embed" },
  { path: "/v1/images/generations", kind: "image", defaultModel: modelKeysOfType("image")[0] ?? "image" },
]);

/**
 * Resolve the request body's `model` field to an internal MODELS key for a
 * given endpoint. Pure and total: an unknown or missing name falls back to the
 * endpoint default, and a name that resolves to the wrong *kind* (e.g. an embed
 * model requested at the chat endpoint) also falls back — the endpoint's kind
 * is authoritative for pricing and metering.
 */
export function resolveModel(body: unknown, endpoint: OpenAIEndpoint): string {
  const requested =
    body && typeof body === "object" && typeof (body as { model?: unknown }).model === "string"
      ? (body as { model: string }).model.trim().toLowerCase()
      : "";

  const aliased = MODEL_ALIASES[requested];
  if (aliased && MODELS[aliased]?.type === endpoint.kind) {
    return aliased;
  }
  return endpoint.defaultModel;
}

/** The candidate internal model keys an endpoint may route to (all of its kind). */
export function candidateModels(endpoint: OpenAIEndpoint): string[] {
  return Object.entries(MODELS)
    .filter(([, config]) => config.type === endpoint.kind)
    .map(([key]) => key);
}

/**
 * The maxPrice (USD string) to quote at an OpenAI endpoint: the *largest*
 * maxPrice across the models it can route to, so the 402 authorization covers
 * whichever model the body selects. The meter clamps to actual usage, so the
 * agent still pays only for the resolved model's real cost — quoting the max is
 * a ceiling, not a charge.
 */
export function endpointMaxPrice(endpoint: OpenAIEndpoint): string {
  const candidates = candidateModels(endpoint);
  let bestKey = endpoint.defaultModel;
  let bestUnits = parseUsdcAmount(MODELS[bestKey].maxPrice);
  for (const key of candidates) {
    const units = parseUsdcAmount(MODELS[key].maxPrice);
    if (BigInt(units) > BigInt(bestUnits)) {
      bestUnits = units;
      bestKey = key;
    }
  }
  return MODELS[bestKey].maxPrice;
}
