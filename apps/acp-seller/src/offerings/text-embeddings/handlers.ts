import { MODEL_REGISTRY } from "@x402cloud/protocol";
import { createHandlers } from "../../handler-factory.js";

const { executeJob, validateRequirements, requestPayment } = createHandlers({
  kind: "embed",
  model: MODEL_REGISTRY.embed.cfModel,
  description: "Text embeddings with BGE-M3",
});

export { executeJob, validateRequirements, requestPayment };
