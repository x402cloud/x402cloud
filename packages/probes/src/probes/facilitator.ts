import { wrapProbe } from "../wrap.js";

export const facilitatorHealth = wrapProbe("facilitator-health", async (target, signal) => {
  if (target.facilitator === null) {
    return { name: "facilitator-health", status: "skip" };
  }

  const healthResponse = await fetch(`${target.facilitator}/health`, { signal });

  if (!healthResponse.ok) {
    return {
      name: "facilitator-health",
      status: "fail",
      error: `Health endpoint returned ${healthResponse.status}`,
    };
  }

  const supportedResponse = await fetch(`${target.facilitator}/supported`, { signal });

  if (!supportedResponse.ok) {
    return {
      name: "facilitator-health",
      status: "fail",
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
    meta: {
      schemes: supported.schemes ?? [],
      networks: supported.networks ?? [],
      address,
    },
  };
});
