import { wrapProbe } from "../wrap.js";

export const paymentFlow = wrapProbe("payment-flow", async (target, signal) => {
  if (target.infer === null) {
    return { name: "payment-flow", status: "skip" };
  }

  // Fetch available models to find an endpoint to test against
  const modelsResponse = await fetch(`${target.infer}/models`, { signal });

  if (!modelsResponse.ok) {
    return {
      name: "payment-flow",
      status: "fail",
      error: `Could not fetch models: ${modelsResponse.status}`,
    };
  }

  const modelsData = (await modelsResponse.json()) as {
    data?: Array<{ id: string }>;
    models?: string[];
  };
  const models = modelsData.data?.map((m) => m.id) ?? modelsData.models ?? [];

  if (models.length === 0) {
    return {
      name: "payment-flow",
      status: "fail",
      error: "No models available to test payment flow",
    };
  }

  // POST to the first model without a payment header -- expect 402
  const model = models[0];
  const inferResponse = await fetch(`${target.infer}/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
    signal,
  });

  if (inferResponse.status !== 402) {
    return {
      name: "payment-flow",
      status: "fail",
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
      error: "402 response missing x402Version or accepts array",
      meta: { statusCode: 402, x402Version: body.x402Version, schemesOffered },
    };
  }

  return {
    name: "payment-flow",
    status: "pass",
    meta: {
      statusCode: 402,
      x402Version: body.x402Version,
      schemesOffered,
    },
  };
});
