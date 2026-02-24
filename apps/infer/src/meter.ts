import type { MeterFunction } from "@x402cloud/protocol";
import { MODELS } from "./models.js";
import type { ModelConfig } from "./models.js";
import {
  computeTextCost,
  computeEmbedCost,
  computeImageCost,
} from "./pricing.js";

/**
 * Estimate token count from text (rough: 1 token ~ 4 chars).
 * Workers AI sometimes returns usage; fall back to char estimation.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Format a cost as USDC smallest units (6 decimals) */
function toMicroUsdc(cost: number): string {
  return Math.round(cost * 1e6).toString();
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
      cost = toMicroUsdc(computeImageCost());
    } else if (config.type === "embed") {
      // Estimate input tokens from request body
      const reqBody = await request.clone().json().catch(() => ({})) as Record<string, any>;
      const input = reqBody.input ?? reqBody.text ?? "";
      const texts = Array.isArray(input) ? input : [input];
      const inputTokens = texts.reduce((sum: number, t: string) => sum + estimateTokens(t), 0);
      cost = toMicroUsdc(computeEmbedCost(config.neurons, inputTokens));
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

      cost = toMicroUsdc(computeTextCost(config.neurons, inputTokens, outputTokens));
    }

    // Never charge more than authorized
    if (BigInt(cost) > BigInt(authorizedAmount)) {
      return authorizedAmount;
    }

    return cost;
  };
}
