import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "text",
  model: "@cf/qwen/qwen2.5-coder-32b-instruct",
  defaults: { max_tokens: 1024, temperature: 0.3 },
  description: "Code generation",
});

export { executeJob, validateRequirements, requestPayment };
