/**
 * ACP Seller Runtime for x402cloud
 *
 * This app runs on Railway and serves as the Virtuals ACP marketplace seller.
 * It accepts ACP jobs and calls Cloudflare Workers AI REST API directly.
 *
 * Setup:
 *   1. Register as Provider at https://app.virtuals.io/acp/join
 *   2. Get Cloudflare API token with Workers AI access
 *   3. Install openclaw-acp: git clone https://github.com/Virtual-Protocol/openclaw-acp
 *   4. Run `acp setup` and copy offerings from src/offerings/
 *   5. Register each offering: `acp sell create <offering-name>`
 *   6. Deploy to Railway: `acp deploy railway`
 *   7. Set CF_ACCOUNT_ID and CF_API_TOKEN in Railway env vars
 *
 * Offerings:
 *   - text-generation  ($0.013) — Llama 4 Scout, Granite, Llama 3.3 70B
 *   - code-generation  ($0.014) — Qwen 2.5 Coder 32B
 *   - deep-reasoning   ($0.025) — DeepSeek R1 Distill 32B
 *   - text-embeddings  ($0.001) — BGE-M3
 *   - image-generation ($0.015) — FLUX.1 Schnell
 *
 * Each offering directory contains:
 *   - offering.json  — ACP offering metadata (name, fee, requirement schema)
 *   - handlers.ts    — executeJob, validateRequirements, requestPayment
 *
 * The handlers call Cloudflare Workers AI REST API:
 *   https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{MODEL}
 *
 * Payment flow:
 *   Agent discovers offerings on ACP marketplace
 *   -> Creates job + locks USDC in escrow
 *   -> Our runtime accepts, buyer pays
 *   -> executeJob() calls CF Workers AI
 *   -> Deliverable returned via ACP
 *   -> Buyer approves -> escrow releases (80% us, 20% Virtuals)
 */

// Re-export all offering handlers for openclaw-acp runtime discovery
export * as textGeneration from "./offerings/text-generation/handlers.js";
export * as codeGeneration from "./offerings/code-generation/handlers.js";
export * as deepReasoning from "./offerings/deep-reasoning/handlers.js";
export * as textEmbeddings from "./offerings/text-embeddings/handlers.js";
export * as imageGeneration from "./offerings/image-generation/handlers.js";

// Validate required env vars on startup
const required = ["CF_ACCOUNT_ID", "CF_API_TOKEN"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

console.log("ACP Seller Runtime ready");
console.log("Offerings: text-generation, code-generation, deep-reasoning, text-embeddings, image-generation");
