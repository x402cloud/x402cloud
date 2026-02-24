import type { MeterFunction } from "@x402cloud/protocol";
import { MODELS, COST_PER_NEURON, MARKUP, BASE_FEE, IMAGE_NEURONS_PER_GEN } from "./models.js";
import type { ModelConfig } from "./models.js";

/**
 * Estimate token count from text (rough: 1 token ~ 4 chars).
 * Workers AI sometimes returns usage; fall back to char estimation.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compute USDC cost in smallest units (6 decimals) for a text model.
 * Uses neuron rates: cost = (tokens / 1M) * neuronsPerM * costPerNeuron * markup + baseFee
 */
function computeTextCost(
  config: ModelConfig,
  inputTokens: number,
  outputTokens: number,
): string {
  const inputCost = (inputTokens / 1_000_000) * config.neurons.inputPerMillion * COST_PER_NEURON;
  const outputCost = (outputTokens / 1_000_000) * config.neurons.outputPerMillion * COST_PER_NEURON;
  const total = (inputCost + outputCost) * MARKUP + BASE_FEE;
  return Math.round(total * 1e6).toString();
}

/**
 * Compute USDC cost for embeddings.
 */
function computeEmbedCost(config: ModelConfig, inputTokens: number): string {
  const cost = (inputTokens / 1_000_000) * config.neurons.inputPerMillion * COST_PER_NEURON;
  const total = cost * MARKUP + BASE_FEE;
  return Math.round(total * 1e6).toString();
}

/**
 * Compute USDC cost for image generation (flat per generation).
 */
function computeImageCost(): string {
  const cost = IMAGE_NEURONS_PER_GEN * COST_PER_NEURON;
  const total = cost * MARKUP + BASE_FEE;
  return Math.round(total * 1e6).toString();
}

/**
 * Create a meter function for a specific model.
 * The meter reads the response body to count output tokens, then computes cost.
 *
 * IMPORTANT: The response body can only be read once. The middleware clones
 * the response before passing it here, so we can safely read it.
 */
export function createMeter(modelName: string): MeterFunction {
  const config = MODELS[modelName];
  if (!config) throw new Error(`Unknown model: ${modelName}`);

  return async ({ request, response, authorizedAmount }) => {
    let cost: string;

    if (config.type === "image") {
      cost = computeImageCost();
    } else if (config.type === "embed") {
      // Estimate input tokens from request body
      const reqBody = await request.clone().json().catch(() => ({})) as Record<string, any>;
      const input = reqBody.input ?? reqBody.text ?? "";
      const texts = Array.isArray(input) ? input : [input];
      const inputTokens = texts.reduce((sum: number, t: string) => sum + estimateTokens(t), 0);
      cost = computeEmbedCost(config, inputTokens);
    } else {
      // Text model: estimate from request + response
      const reqBody = await request.clone().json().catch(() => ({})) as Record<string, any>;
      const resBody = await response.clone().json().catch(() => ({})) as Record<string, any>;

      // Try to use usage from Workers AI response first
      const usage = resBody?.usage;
      let inputTokens: number;
      let outputTokens: number;

      if (usage?.prompt_tokens && usage?.completion_tokens) {
        inputTokens = usage.prompt_tokens;
        outputTokens = usage.completion_tokens;
      } else {
        // Estimate from content
        const messages = reqBody.messages ?? [];
        const inputText = messages.map((m: any) => m.content ?? "").join(" ");
        inputTokens = estimateTokens(inputText);

        const outputText =
          resBody?.choices?.[0]?.message?.content ?? resBody?.response ?? "";
        outputTokens = estimateTokens(outputText);
      }

      cost = computeTextCost(config, inputTokens, outputTokens);
    }

    // Never charge more than authorized
    if (BigInt(cost) > BigInt(authorizedAmount)) {
      return authorizedAmount;
    }

    return cost;
  };
}
