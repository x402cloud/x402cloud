import type { Probe } from "../types.js";

export const paymentFlow: Probe = async (target) => {
  const start = Date.now();

  if (target.infer === null) {
    return { name: "payment-flow", status: "skip", latencyMs: 0 };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    // Fetch available models to find an endpoint to test against
    const modelsResponse = await fetch(`${target.infer}/models`, {
      signal: controller.signal,
    });

    if (!modelsResponse.ok) {
      clearTimeout(timeout);
      return {
        name: "payment-flow",
        status: "fail",
        latencyMs: Date.now() - start,
        error: `Could not fetch models: ${modelsResponse.status}`,
      };
    }

    const modelsData = (await modelsResponse.json()) as {
      data?: Array<{ id: string }>;
      models?: string[];
    };
    const models = modelsData.data?.map((m) => m.id) ?? modelsData.models ?? [];

    if (models.length === 0) {
      clearTimeout(timeout);
      return {
        name: "payment-flow",
        status: "fail",
        latencyMs: Date.now() - start,
        error: "No models available to test payment flow",
      };
    }

    // POST to the first model without a payment header -- expect 402
    const model = models[0];
    const inferResponse = await fetch(`${target.infer}/${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (inferResponse.status !== 402) {
      return {
        name: "payment-flow",
        status: "fail",
        latencyMs: Date.now() - start,
        error: `Expected 402, got ${inferResponse.status}`,
        meta: { statusCode: inferResponse.status },
      };
    }

    const body = (await inferResponse.json()) as {
      x402Version?: number;
      accepts?: Array<{ scheme?: string; network?: string; maxAmount?: string }>;
    };

    const schemesOffered = (body.accepts ?? []).map((a) => a.scheme ?? "unknown");

    if (!body.x402Version || !body.accepts || body.accepts.length === 0) {
      return {
        name: "payment-flow",
        status: "warn",
        latencyMs: Date.now() - start,
        error: "402 response missing x402Version or accepts array",
        meta: { statusCode: 402, x402Version: body.x402Version, schemesOffered },
      };
    }

    return {
      name: "payment-flow",
      status: "pass",
      latencyMs: Date.now() - start,
      meta: {
        statusCode: 402,
        x402Version: body.x402Version,
        schemesOffered,
      },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "payment-flow",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
    };
  }
};
