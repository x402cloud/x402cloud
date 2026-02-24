import { MODEL_REGISTRY } from "@x402cloud/protocol";
import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "text",
  model: MODEL_REGISTRY.code.cfModel,
  defaults: { max_tokens: 1024, temperature: 0.3 },
  description: "Code generation",
});

export { executeJob, validateRequirements, requestPayment };
