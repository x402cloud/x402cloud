import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "text",
  model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  defaults: { max_tokens: 2048, temperature: 0.5 },
  description: "Deep reasoning",
});

export { executeJob, validateRequirements, requestPayment };
