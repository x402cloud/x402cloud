import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "text",
  models: {
    nano: "@cf/ibm-granite/granite-4.0-h-micro",
    fast: "@cf/meta/llama-4-scout-17b-16e-instruct",
    smart: "@cf/meta/llama-3.1-8b-instruct-fast",
    big: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  },
  defaultModel: "fast",
  defaults: { max_tokens: 512, temperature: 0.7 },
  description: "Text generation",
});

export { executeJob, validateRequirements, requestPayment };
