import type { Probe } from "../types.js";

export const inferHealth: Probe = async (target) => {
  const start = Date.now();

  if (target.infer === null) {
    return { name: "infer-health", status: "skip", latencyMs: 0 };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${target.infer}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        name: "infer-health",
        status: "fail",
        latencyMs: Date.now() - start,
        error: `Health endpoint returned ${response.status}`,
      };
    }

    return {
      name: "infer-health",
      status: "pass",
      latencyMs: Date.now() - start,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "infer-health",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
    };
  }
};

export const inferModels: Probe = async (target) => {
  const start = Date.now();

  if (target.infer === null) {
    return { name: "infer-models", status: "skip", latencyMs: 0 };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${target.infer}/models`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        name: "infer-models",
        status: "fail",
        latencyMs: Date.now() - start,
        error: `Models endpoint returned ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      data?: Array<{ id: string }>;
      models?: string[];
    };
    const models = data.data?.map((m) => m.id) ?? data.models ?? [];

    return {
      name: "infer-models",
      status: "pass",
      latencyMs: Date.now() - start,
      meta: { modelCount: models.length, models },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "infer-models",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
    };
  }
};
