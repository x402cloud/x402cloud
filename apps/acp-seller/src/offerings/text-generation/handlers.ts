import { MODEL_REGISTRY } from "@x402cloud/protocol";
import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "text",
  models: {
    nano: MODEL_REGISTRY.nano.cfModel,
    fast: MODEL_REGISTRY.fast.cfModel,
    smart: MODEL_REGISTRY.smart.cfModel,
    big: MODEL_REGISTRY.big.cfModel,
  },
  defaultModel: "fast",
  defaults: { max_tokens: 512, temperature: 0.7 },
  description: "Text generation",
});

export { executeJob, validateRequirements, requestPayment };
