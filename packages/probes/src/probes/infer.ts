import { wrapProbe } from "../wrap.js";

export const inferHealth = wrapProbe("infer-health", async (target, signal) => {
  if (target.infer === null) {
    return { name: "infer-health", status: "skip" };
  }

  const response = await fetch(`${target.infer}/health`, { signal });

  if (!response.ok) {
    return {
      name: "infer-health",
      status: "fail",
      error: `Health endpoint returned ${response.status}`,
    };
  }

  return { name: "infer-health", status: "pass" };
});

export const inferModels = wrapProbe("infer-models", async (target, signal) => {
  if (target.infer === null) {
    return { name: "infer-models", status: "skip" };
  }

  const response = await fetch(`${target.infer}/models`, { signal });

  if (!response.ok) {
    return {
      name: "infer-models",
      status: "fail",
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
    meta: { modelCount: models.length, models },
  };
});
