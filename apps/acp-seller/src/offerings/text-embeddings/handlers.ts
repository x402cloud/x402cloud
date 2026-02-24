import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "embed",
  model: "@cf/baai/bge-m3",
  description: "Text embeddings with BGE-M3",
});

export { executeJob, validateRequirements, requestPayment };
