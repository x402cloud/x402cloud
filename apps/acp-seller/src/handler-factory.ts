import type { ExecuteJobResult, ValidationResult } from "./types.js";

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

async function runModel(model: string, body: object): Promise<unknown> {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error(`CF API ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// --- Offering configs ---

type TextOfferingConfig = {
  kind: "text";
  models?: Record<string, string>;
  model?: string;
  defaultModel?: string;
  defaults: { max_tokens: number; temperature: number };
  description: string;
};

type EmbedOfferingConfig = {
  kind: "embed";
  model: string;
  description: string;
};

type ImageOfferingConfig = {
  kind: "image";
  model: string;
  defaults: { num_steps: number };
  description: string;
};

export type OfferingConfig = TextOfferingConfig | EmbedOfferingConfig | ImageOfferingConfig;

export type OfferingHandlers = {
  executeJob: (request: any) => Promise<ExecuteJobResult>;
  validateRequirements: (request: any) => ValidationResult;
  requestPayment: (request: any) => string;
};

export function createHandlers(config: OfferingConfig): OfferingHandlers {
  switch (config.kind) {
    case "text":
      return createTextHandlers(config);
    case "embed":
      return createEmbedHandlers(config);
    case "image":
      return createImageHandlers(config);
  }
}

function createTextHandlers(config: TextOfferingConfig): OfferingHandlers {
  const models = config.models ?? { [config.defaultModel ?? "default"]: config.model! };
  const defaultTier = config.defaultModel ?? Object.keys(models)[0];

  return {
    async executeJob(request: any): Promise<ExecuteJobResult> {
      const tier = request.model || defaultTier;
      const model = models[tier] || models[defaultTier];
      const data = await runModel(model, {
        messages: request.messages,
        max_tokens: request.max_tokens ?? config.defaults.max_tokens,
        temperature: request.temperature ?? config.defaults.temperature,
      });
      return { deliverable: JSON.stringify(data) };
    },

    validateRequirements(request: any): ValidationResult {
      if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
        return { valid: false, reason: "messages array is required and must not be empty" };
      }
      if (config.models && request.model && !models[request.model]) {
        return { valid: false, reason: `Invalid model. Choose: ${Object.keys(models).join(", ")}` };
      }
      return { valid: true };
    },

    requestPayment(request: any): string {
      const model = request.model || defaultTier;
      return `${config.description} with ${model} model. Payment required to proceed.`;
    },
  };
}

function createEmbedHandlers(config: EmbedOfferingConfig): OfferingHandlers {
  return {
    async executeJob(request: any): Promise<ExecuteJobResult> {
      const input = request.texts || (request.text ? [request.text] : []);
      const data = await runModel(config.model, { text: input });
      return { deliverable: JSON.stringify(data) };
    },

    validateRequirements(request: any): ValidationResult {
      if (!request.text && (!request.texts || request.texts.length === 0)) {
        return { valid: false, reason: "Either 'text' (string) or 'texts' (array) is required" };
      }
      return { valid: true };
    },

    requestPayment(request: any): string {
      const count = request.texts?.length || 1;
      return `Embedding ${count} text(s) with BGE-M3. Payment required to proceed.`;
    },
  };
}

function createImageHandlers(config: ImageOfferingConfig): OfferingHandlers {
  return {
    async executeJob(request: any): Promise<ExecuteJobResult> {
      const data = await runModel(config.model, {
        prompt: request.prompt,
        num_steps: request.num_steps ?? config.defaults.num_steps,
      });
      return { deliverable: JSON.stringify(data) };
    },

    validateRequirements(request: any): ValidationResult {
      if (!request.prompt || typeof request.prompt !== "string" || request.prompt.trim().length === 0) {
        return { valid: false, reason: "prompt is required and must be a non-empty string" };
      }
      return { valid: true };
    },

    requestPayment(): string {
      return `${config.description}. Payment required to proceed.`;
    },
  };
}
