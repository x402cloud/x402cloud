import { MODEL_REGISTRY } from "@x402cloud/protocol";
import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "image",
  model: MODEL_REGISTRY.image.cfModel,
  defaults: { num_steps: 4 },
  description: "Image generation with FLUX.1 Schnell",
});

export { executeJob, validateRequirements, requestPayment };
