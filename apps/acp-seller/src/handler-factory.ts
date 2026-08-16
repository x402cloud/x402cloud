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

// --- Job request shapes (the typed, post-parse view of each offering's raw body) ---

export type ChatMessage = { role: string; content: string };

export type TextJobRequest = {
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
};

export type EmbedJobRequest = {
  text?: string;
  texts?: string[];
};

export type ImageJobRequest = {
  prompt: string;
  num_steps?: number;
};

export type JobRequest = TextJobRequest | EmbedJobRequest | ImageJobRequest;

export type OfferingHandlers<TRequest = unknown> = {
  executeJob: (request: TRequest) => Promise<ExecuteJobResult>;
  validateRequirements: (request: TRequest) => ValidationResult;
  requestPayment: (request: TRequest) => string;
};

export function createHandlers(config: OfferingConfig): OfferingHandlers<unknown> {
  switch (config.kind) {
    case "text":
      return createTextHandlers(config);
    case "embed":
      return createEmbedHandlers(config);
    case "image":
      return createImageHandlers(config);
  }
}

// --- Parsing: raw unknown -> typed request or a rejection reason. ---
// Fail loudly at the boundary — parse once, share the result between
// validateRequirements (surfaces the reason) and executeJob (throws it).

type ParseResult<T> = { valid: true; value: T } | { valid: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTextRequest(
  raw: unknown,
  availableModels: Record<string, string> | undefined
): ParseResult<TextJobRequest> {
  if (!isRecord(raw) || !Array.isArray(raw.messages) || raw.messages.length === 0) {
    return { valid: false, reason: "messages array is required and must not be empty" };
  }
  const { messages, model, max_tokens, temperature } = raw;
  if (availableModels && typeof model === "string" && !availableModels[model]) {
    return {
      valid: false,
      reason: `Invalid model. Choose: ${Object.keys(availableModels).join(", ")}`,
    };
  }
  return {
    valid: true,
    value: {
      messages: messages as ChatMessage[],
      model: typeof model === "string" ? model : undefined,
      max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
      temperature: typeof temperature === "number" ? temperature : undefined,
    },
  };
}

function parseEmbedRequest(raw: unknown): ParseResult<EmbedJobRequest> {
  const text = isRecord(raw) && typeof raw.text === "string" ? raw.text : undefined;
  const texts = isRecord(raw) && Array.isArray(raw.texts) ? (raw.texts as string[]) : undefined;
  if (!text && (!texts || texts.length === 0)) {
    return { valid: false, reason: "Either 'text' (string) or 'texts' (array) is required" };
  }
  return { valid: true, value: { text, texts } };
}

function parseImageRequest(raw: unknown): ParseResult<ImageJobRequest> {
  const prompt = isRecord(raw) ? raw.prompt : undefined;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return { valid: false, reason: "prompt is required and must be a non-empty string" };
  }
  const num_steps = isRecord(raw) && typeof raw.num_steps === "number" ? raw.num_steps : undefined;
  return { valid: true, value: { prompt, num_steps } };
}

// --- Handlers ---

function createTextHandlers(config: TextOfferingConfig): OfferingHandlers<unknown> {
  const models = config.models ?? { [config.defaultModel ?? "default"]: config.model! };
  const defaultTier = config.defaultModel ?? Object.keys(models)[0];

  return {
    async executeJob(request: unknown): Promise<ExecuteJobResult> {
      const parsed = parseTextRequest(request, config.models);
      if (!parsed.valid) throw new Error(parsed.reason);
      const { value } = parsed;
      const tier = value.model || defaultTier;
      const model = models[tier] || models[defaultTier];
      const data = await runModel(model, {
        messages: value.messages,
        max_tokens: value.max_tokens ?? config.defaults.max_tokens,
        temperature: value.temperature ?? config.defaults.temperature,
      });
      return { deliverable: JSON.stringify(data) };
    },

    validateRequirements(request: unknown): ValidationResult {
      const parsed = parseTextRequest(request, config.models);
      return parsed.valid ? { valid: true } : { valid: false, reason: parsed.reason };
    },

    requestPayment(request: unknown): string {
      const parsed = parseTextRequest(request, config.models);
      const model = (parsed.valid && parsed.value.model) || defaultTier;
      return `${config.description} with ${model} model. Payment required to proceed.`;
    },
  };
}

function createEmbedHandlers(config: EmbedOfferingConfig): OfferingHandlers<unknown> {
  return {
    async executeJob(request: unknown): Promise<ExecuteJobResult> {
      const parsed = parseEmbedRequest(request);
      if (!parsed.valid) throw new Error(parsed.reason);
      const { value } = parsed;
      const input = value.texts || (value.text ? [value.text] : []);
      const data = await runModel(config.model, { text: input });
      return { deliverable: JSON.stringify(data) };
    },

    validateRequirements(request: unknown): ValidationResult {
      const parsed = parseEmbedRequest(request);
      return parsed.valid ? { valid: true } : { valid: false, reason: parsed.reason };
    },

    requestPayment(request: unknown): string {
      const parsed = parseEmbedRequest(request);
      const count = (parsed.valid && parsed.value.texts?.length) || 1;
      return `Embedding ${count} text(s) with BGE-M3. Payment required to proceed.`;
    },
  };
}

function createImageHandlers(config: ImageOfferingConfig): OfferingHandlers<unknown> {
  return {
    async executeJob(request: unknown): Promise<ExecuteJobResult> {
      const parsed = parseImageRequest(request);
      if (!parsed.valid) throw new Error(parsed.reason);
      const { value } = parsed;
      const data = await runModel(config.model, {
        prompt: value.prompt,
        num_steps: value.num_steps ?? config.defaults.num_steps,
      });
      return { deliverable: JSON.stringify(data) };
    },

    validateRequirements(request: unknown): ValidationResult {
      const parsed = parseImageRequest(request);
      return parsed.valid ? { valid: true } : { valid: false, reason: parsed.reason };
    },

    requestPayment(): string {
      return `${config.description}. Payment required to proceed.`;
    },
  };
}
