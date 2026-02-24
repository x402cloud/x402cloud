import { MODEL_REGISTRY } from "@x402cloud/protocol";
import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "text",
  model: MODEL_REGISTRY.think.cfModel,
  defaults: { max_tokens: 2048, temperature: 0.5 },
  description: "Deep reasoning",
});

export { executeJob, validateRequirements, requestPayment };
