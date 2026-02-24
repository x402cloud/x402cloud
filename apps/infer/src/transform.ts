import type { ModelConfig } from "./models.js";

export type ChatResult = {
  choices?: { message?: { content?: string } }[];
  response?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type EmbeddingResult = {
  data?: number[][];
  embedding?: number[];
};

export function toOpenAIChatResponse(result: string | ChatResult, model: string, id: string, created: number) {
  const content: string =
    typeof result === "string"
      ? result
      : result?.choices?.[0]?.message?.content
        ?? result?.response
        ?? "";

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: (typeof result !== "string" ? result?.usage : undefined) ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function toOpenAIEmbeddingResponse(result: EmbeddingResult, model: string) {
  const vectors: number[][] = result?.data ?? [result?.embedding ?? []];

  return {
    object: "list",
    data: vectors.map((embedding: number[], index: number) => ({
      object: "embedding",
      index,
      embedding,
    })),
    model,
    usage: { prompt_tokens: 0, total_tokens: 0 },
  };
}

export function toOpenAIModelList(models: Record<string, ModelConfig>) {
  return {
    object: "list",
    data: Object.entries(models).map(([id, { model, description, maxPrice }]) => ({
      id,
      object: "model",
      created: 1700000000,
      owned_by: "x402cloud",
      description,
      cf_model: model,
      maxPrice,
    })),
  };
}

export function toLlmsTxt(models: Record<string, ModelConfig>, recipient: string): string {
  return `# infer.x402cloud.ai

Edge AI inference with x402 micropayments. Pay per token with USDC — no signup, no API keys.

## Usage

OpenAI-compatible. Set base_url to https://infer.x402cloud.ai and POST to any model endpoint.

## Payment Scheme

Uses x402 "upto" (metered) payments: authorize a max amount, pay only for actual tokens used.

## Models

${Object.entries(models)
  .map(([k, v]) => `- /${k} (max ${v.maxPrice}) — ${v.description} [${v.model}]`)
  .join("\n")}

## Request Format

POST /{model} with JSON body:
\`\`\`json
{ "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 512 }
\`\`\`

## Payment

x402 protocol — USDC on Base. Include payment header automatically via x402 client.
Recipient: ${recipient}
`;
}
