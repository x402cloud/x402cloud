import type { MeterFunction, ModelType } from "@x402cloud/protocol";
import { retailPrice, DEFAULT_MARGIN_BPS } from "@x402cloud/middleware";
import { MODELS, type ModelConfig } from "./models.js";
import { resolveModel, type OpenAIEndpoint } from "./openai.js";
import {
  wholesaleTextCost,
  wholesaleEmbedCost,
  wholesaleImageCost,
} from "./pricing.js";

/**
 * Estimate token count from text (rough: 1 token ~ 4 chars).
 * Workers AI sometimes returns usage; fall back to char estimation.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type WholesaleExtractorArgs = {
  config: ModelConfig;
  request: Request;
  response: Response;
};

/** Computes the wholesale USDC cost (in micro-USDC) for one model kind. */
type WholesaleExtractor = (args: WholesaleExtractorArgs) => Promise<string>;

/**
 * One extractor per `ModelType` — adding a model kind (e.g. audio) is one map
 * entry, not a new `if`/`else` branch in `createMeter`.
 */
const WHOLESALE_EXTRACTORS: Record<ModelType, WholesaleExtractor> = {
  image: async () => wholesaleImageCost(),

  embed: async ({ config, request }) => {
    const reqBody = (await request
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;
    const input = (reqBody.input as unknown) ?? (reqBody.text as unknown) ?? "";
    const texts = (Array.isArray(input) ? input : [input]) as unknown[];
    const inputTokens = texts.reduce<number>(
      (sum, t) => sum + estimateTokens(typeof t === "string" ? t : ""),
      0,
    );
    return wholesaleEmbedCost(config.neurons, inputTokens);
  },

  text: async ({ config, request, response }) => {
    const reqBody = (await request
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;
    const resBody = (await response
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;

    const usage = resBody.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    let inputTokens: number;
    let outputTokens: number;

    if (
      usage &&
      typeof usage.prompt_tokens === "number" &&
      typeof usage.completion_tokens === "number"
    ) {
      inputTokens = usage.prompt_tokens;
      outputTokens = usage.completion_tokens;
    } else {
      const messages = (reqBody.messages as Array<{ content?: unknown }> | undefined) ?? [];
      const inputText = messages
        .map((m) => (typeof m?.content === "string" ? m.content : ""))
        .join(" ");
      inputTokens = estimateTokens(inputText);

      const choices = resBody.choices as
        | Array<{ message?: { content?: unknown } }>
        | undefined;
      const choiceContent = choices?.[0]?.message?.content;
      const fallbackResponse = resBody.response;
      const outputText =
        typeof choiceContent === "string"
          ? choiceContent
          : typeof fallbackResponse === "string"
          ? fallbackResponse
          : "";
      outputTokens = estimateTokens(outputText);
    }

    return wholesaleTextCost(config.neurons, inputTokens, outputTokens);
  },
};

/**
 * Create a meter function for a specific model.
 *
 * The meter computes the **wholesale** USDC cost (in micro-USDC), then applies
 * the marketplace margin and clamps to the agent's authorized amount via
 * `retailPrice` from `@x402cloud/middleware`. This is the only place in
 * `apps/infer` that knows about marketplace margin.
 *
 * @param modelName  Key into MODELS
 * @param marginBps  Marketplace take rate. Defaults to `DEFAULT_MARGIN_BPS`
 *                   from middleware — pass an explicit value to override per
 *                   route.
 *
 * IMPORTANT: The middleware clones the response before passing it here, so
 * we can safely read the body.
 */
export function createMeter(
  modelName: string,
  marginBps = DEFAULT_MARGIN_BPS,
): MeterFunction {
  const config = MODELS[modelName];
  if (!config) throw new Error(`Unknown model: ${modelName}`);

  const extractWholesale = WHOLESALE_EXTRACTORS[config.type];

  return async ({ request, response, authorizedAmount }) => {
    const wholesale = await extractWholesale({ config, request, response });
    return retailPrice(wholesale, authorizedAmount, marginBps);
  };
}

/**
 * Create a meter for an OpenAI-compatible endpoint (`/v1/chat/completions`,
 * etc.). The model is dynamic — it comes from the request body's `model` field
 * — so this meter resolves the model per request and delegates to that model's
 * meter via `createMeter`. The agent is therefore billed *exactly* like the
 * underlying short-name route, with no duplicated pricing logic.
 *
 * The endpoint's static maxPrice quote is the ceiling (largest candidate model
 * of this kind); `retailPrice` inside the delegated meter clamps the actual
 * charge to that authorization, so a cheaper resolved model never overcharges.
 */
export function createOpenAIMeter(
  endpoint: OpenAIEndpoint,
  marginBps = DEFAULT_MARGIN_BPS,
): MeterFunction {
  return async (ctx) => {
    const body = (await ctx.request
      .clone()
      .json()
      .catch(() => ({}))) as unknown;
    const modelName = resolveModel(body, endpoint);
    return createMeter(modelName, marginBps)(ctx);
  };
}
