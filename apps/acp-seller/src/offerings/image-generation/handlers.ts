import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "image",
  model: "@cf/black-forest-labs/flux-1-schnell",
  defaults: { num_steps: 4 },
  description: "Image generation with FLUX.1 Schnell",
});

export { executeJob, validateRequirements, requestPayment };
