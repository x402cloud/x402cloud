import type { Probe } from "../types.js";

export const facilitatorHealth: Probe = async (target) => {
  const start = Date.now();

  if (target.facilitator === null) {
    return { name: "facilitator-health", status: "skip", latencyMs: 0 };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const healthResponse = await fetch(`${target.facilitator}/health`, {
      signal: controller.signal,
    });

    if (!healthResponse.ok) {
      clearTimeout(timeout);
      return {
        name: "facilitator-health",
        status: "fail",
        latencyMs: Date.now() - start,
        error: `Health endpoint returned ${healthResponse.status}`,
      };
    }

    const supportedResponse = await fetch(`${target.facilitator}/supported`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!supportedResponse.ok) {
      return {
        name: "facilitator-health",
        status: "fail",
        latencyMs: Date.now() - start,
        error: `Supported endpoint returned ${supportedResponse.status}`,
      };
    }

    const supported = (await supportedResponse.json()) as {
      schemes?: string[];
      networks?: string[];
      address?: string;
      facilitator?: string;
    };

    const address = supported.facilitator ?? supported.address ?? "unknown";

    return {
      name: "facilitator-health",
      status: "pass",
      latencyMs: Date.now() - start,
      meta: {
        schemes: supported.schemes ?? [],
        networks: supported.networks ?? [],
        address,
      },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      name: "facilitator-health",
      status: "fail",
      latencyMs: Date.now() - start,
      error: message,
    };
  }
};
