import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";
import type { UptoRoutesConfig } from "@x402cloud/middleware";
import type { MiddlewareOptions } from "@x402cloud/middleware";
import type { ServiceMeta, ServiceRoute, ServiceSkill } from "@x402cloud/discovery";
import { mountDiscovery } from "@x402cloud/discovery/hono";
import { NETWORK_NAME_TO_CAIP2 } from "@x402cloud/evm";
import { MODELS, type ModelType } from "./models.js";
import { createMeter, createOpenAIMeter } from "./meter.js";
import {
  OPENAI_ENDPOINTS,
  resolveModel,
  endpointMaxPrice,
  type OpenAIEndpoint,
} from "./openai.js";
import {
  createKvRecorder,
  type SettlementRecorder,
  type KVPut,
} from "./recorder.js";
import {
  toOpenAIChatResponse,
  toOpenAIEmbeddingResponse,
  toOpenAIModelList,
  type ChatResult,
  type EmbeddingResult,
} from "./transform.js";

const BASE_URL = "https://infer.x402cloud.ai";

/**
 * Optional Cloudflare Workers Rate Limiting binding. When present (configured
 * in wrangler.toml as a `[[unsafe.bindings]]` of kind "ratelimit"), the free
 * discovery routes are rate-limited per-IP. Without it, requests pass through
 * — operators should still gate the deployment behind Cloudflare's edge rate
 * limiting or a WAF.
 */
type RateLimiter = { limit: (input: { key: string }) => Promise<{ success: boolean }> };

type Bindings = {
  AI: Ai;
  NETWORK: string;
  FACILITATOR_URL: string;
  /** Settlement wallet address of the facilitator (its /supported `facilitator` field). Advertised to clients as `extra.facilitator` — the canonical upto witness binds it. */
  FACILITATOR_ADDRESS: `0x${string}`;
  /** Optional. Comma-separated CORS allow-list, e.g. "https://x402cloud.ai,https://app.x402cloud.ai". Default: "*". */
  CORS_ALLOWED_ORIGINS?: string;
  /** Optional rate-limit binding. */
  RATE_LIMITER?: RateLimiter;
  /**
   * Optional KV namespace for durable settlement recording. When present, the
   * settlement hooks persist intent/outcome for reconciliation; when absent,
   * recording is a safe no-op (see buildSettlementOptions).
   */
  SETTLEMENTS?: KVPut;
};

type Env = { Bindings: Bindings };

const SERVER_ADDRESS = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";

// Re-exported for tests; the table itself lives in @x402cloud/evm.
const NETWORK_MAP = NETWORK_NAME_TO_CAIP2;

// --- Route config ---

function buildRoutes(network: `${string}:${string}`): UptoRoutesConfig {
  const routes: UptoRoutesConfig = {};

  // Short-name routes: POST /fast, /smart, ... — one paid route per model.
  for (const [name, config] of Object.entries(MODELS)) {
    routes[`POST /${name}`] = {
      network,
      maxPrice: config.maxPrice,
      payTo: SERVER_ADDRESS,
      maxTimeoutSeconds: 300,
      description: config.description,
      meter: createMeter(name),
    };
  }

  // OpenAI-compatible routes: POST /v1/chat/completions, /v1/embeddings, ...
  // Same payment middleware, same meter pipeline — NOT a free bypass. maxPrice
  // is the ceiling across routable models; the meter resolves the actual model
  // from the body and clamps the charge to its real cost.
  for (const endpoint of OPENAI_ENDPOINTS) {
    routes[`POST ${endpoint.path}`] = {
      network,
      maxPrice: endpointMaxPrice(endpoint),
      payTo: SERVER_ADDRESS,
      maxTimeoutSeconds: 300,
      description: `OpenAI-compatible ${endpoint.kind} endpoint`,
      meter: createOpenAIMeter(endpoint),
    };
  }

  return routes;
}

// --- Discovery routes (mounted via @x402cloud/discovery) ---

const CHAT_REQUEST_SCHEMA = {
  type: "object",
  required: ["messages"],
  properties: {
    messages: { type: "array", items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } } } },
    max_tokens: { type: "integer", default: 512 },
    temperature: { type: "number", default: 0.7 },
  },
};
const CHAT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    object: { type: "string", enum: ["chat.completion"] },
    created: { type: "integer" },
    model: { type: "string" },
    choices: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, message: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } }, finish_reason: { type: "string" } } } },
    usage: { type: "object", properties: { prompt_tokens: { type: "integer" }, completion_tokens: { type: "integer" }, total_tokens: { type: "integer" } } },
  },
};
const EMBED_REQUEST_SCHEMA = {
  type: "object",
  required: ["input"],
  properties: { input: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } },
};
const EMBED_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    object: { type: "string" },
    data: { type: "array", items: { type: "object", properties: { object: { type: "string" }, index: { type: "integer" }, embedding: { type: "array", items: { type: "number" } } } } },
    model: { type: "string" },
  },
};
const IMAGE_REQUEST_SCHEMA = {
  type: "object",
  required: ["prompt"],
  properties: { prompt: { type: "string" }, num_steps: { type: "integer", default: 4 } },
};
const IMAGE_RESPONSE_SCHEMA = { type: "string", format: "binary" };

function exampleFor(name: string, type: ModelType): string[] {
  if (type === "text") return [`POST ${BASE_URL}/${name} with {"messages":[{"role":"user","content":"Hello"}]}`];
  if (type === "embed") return [`POST ${BASE_URL}/${name} with {"input":"text to embed"}`];
  return [`POST ${BASE_URL}/${name} with {"prompt":"a cat in space"}`];
}

const DISCOVERY_META: ServiceMeta = {
  name: "infer.x402cloud.ai",
  description: "AI inference using the x402 protocol standard. OpenAI-compatible. Pay per token with USDC — no signup, no API keys.",
  baseUrl: BASE_URL,
  shortDescription: "Edge AI inference with x402 micropayments. OpenAI-compatible.",
  facilitator: "https://facilitator.x402cloud.ai",
  defaultOutputModes: ["application/json", "image/png"],
};

function openAIDiscoveryRoute(endpoint: OpenAIEndpoint): ServiceRoute {
  const reqSchema =
    endpoint.kind === "text"
      ? CHAT_REQUEST_SCHEMA
      : endpoint.kind === "embed"
        ? EMBED_REQUEST_SCHEMA
        : IMAGE_REQUEST_SCHEMA;
  const resSchema =
    endpoint.kind === "text"
      ? CHAT_RESPONSE_SCHEMA
      : endpoint.kind === "embed"
        ? EMBED_RESPONSE_SCHEMA
        : IMAGE_RESPONSE_SCHEMA;
  return {
    path: endpoint.path,
    method: "POST",
    operationId: endpoint.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
    summary: `OpenAI-compatible ${endpoint.kind} endpoint (model selected via request body)`,
    tags: [endpoint.kind, "openai"],
    kind: endpoint.kind,
    payment: { maxPrice: endpointMaxPrice(endpoint), network: "Base (USDC)", payTo: SERVER_ADDRESS },
    requestSchema: reqSchema,
    responseSchema: resSchema,
    responseContentType: endpoint.kind === "image" ? "image/png" : "application/json",
    examples: [`POST ${BASE_URL}${endpoint.path} with {"model":"${endpoint.defaultModel}", ...}`],
  };
}

const DISCOVERY_ROUTES: ServiceRoute[] = [
  { path: "/models", method: "GET", summary: "List available models", tags: ["free"] },
  { path: "/v1/models", method: "GET", summary: "List available models (OpenAI-compatible)", tags: ["free", "openai"] },
  { path: "/llms.txt", method: "GET", summary: "LLM-readable documentation", tags: ["free"], responseContentType: "text/plain", responseSchema: { type: "string" } },
  ...OPENAI_ENDPOINTS.map(openAIDiscoveryRoute),
  ...Object.entries(MODELS).map(([name, config]) => {
    const isText = config.type === "text";
    const isEmbed = config.type === "embed";
    return {
      path: `/${name}`,
      method: "POST" as const,
      operationId: name,
      summary: config.description,
      tags: [config.type],
      kind: config.type,
      payment: { maxPrice: config.maxPrice, network: "Base (USDC)", payTo: SERVER_ADDRESS },
      requestSchema: isText ? CHAT_REQUEST_SCHEMA : isEmbed ? EMBED_REQUEST_SCHEMA : IMAGE_REQUEST_SCHEMA,
      responseSchema: isText ? CHAT_RESPONSE_SCHEMA : isEmbed ? EMBED_RESPONSE_SCHEMA : IMAGE_RESPONSE_SCHEMA,
      responseContentType: config.type === "image" ? "image/png" : "application/json",
      examples: exampleFor(name, config.type),
    } satisfies ServiceRoute;
  }),
];

const DISCOVERY_SKILLS: ServiceSkill[] = Object.entries(MODELS).map(([name, config]) => ({
  id: name,
  name: `${name} inference`,
  description: config.description,
  tags: [config.type, "ai", "inference", "x402"],
  examples: exampleFor(name, config.type),
}));

// --- Inference handlers ---

async function handleText(c: Context<Env>, name: string) {
  const body = await c.req.json();
  const config = MODELS[name];
  const result = await c.env.AI.run(config.model as Parameters<Ai["run"]>[0], {
    messages: body.messages,
    max_tokens: body.max_tokens ?? 512,
    temperature: body.temperature ?? 0.7,
  });
  const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  return c.json(toOpenAIChatResponse(result as string | ChatResult, name, id, created));
}

async function handleEmbed(c: Context<Env>, name: string) {
  const body = await c.req.json();
  const config = MODELS[name];
  const input = body.input ?? body.messages?.[0]?.content ?? "";
  const texts = Array.isArray(input) ? input : [input];
  const result = await c.env.AI.run(config.model as Parameters<Ai["run"]>[0], {
    text: texts,
  });
  return c.json(toOpenAIEmbeddingResponse(result as EmbeddingResult, name));
}

async function handleImage(c: Context<Env>, name: string) {
  const body = await c.req.json();
  const config = MODELS[name];
  const prompt = body.prompt ?? body.messages?.[0]?.content ?? "";
  const result = await c.env.AI.run(config.model as Parameters<Ai["run"]>[0], {
    prompt,
    num_steps: body.num_steps ?? 4,
  });
  return new Response(result as ReadableStream, {
    headers: { "Content-Type": "image/png" },
  });
}

const HANDLERS: Record<ModelType, (c: Context<Env>, name: string) => Promise<Response>> = {
  text: handleText,
  embed: handleEmbed,
  image: handleImage,
};

// --- Edge hardening ---

/**
 * CORS allow-list is configurable per-deployment; default "*" preserves the
 * open inference posture but lets operators lock down to known frontends.
 */
function corsMiddleware(c: Context<Env>, next: () => Promise<void>) {
  const raw = c.env.CORS_ALLOWED_ORIGINS;
  const origins = raw && raw.length > 0 ? raw.split(",").map((s) => s.trim()) : ["*"];
  return cors({
    origin: origins.length === 1 ? origins[0] : origins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-PAYMENT", "PAYMENT-SIGNATURE"],
    exposeHeaders: ["X-Payment-Settled", "X-Payment-Required"],
    maxAge: 600,
  })(c, next);
}

/**
 * Per-IP rate limit for the free discovery / health routes. Skipped when no
 * binding is configured (the Workers rate-limit binding is optional).
 */
async function rateLimitFree(c: Context<Env>, next: () => Promise<void>) {
  const limiter = c.env.RATE_LIMITER;
  if (!limiter) return next();
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  const { success } = await limiter.limit({ key: `infer:free:${ip}` });
  if (!success) return c.json({ error: "rate_limited" }, 429);
  await next();
}

// --- Deps: immutable per-isolate projection of env ---

type Deps = {
  readonly middleware: ReturnType<typeof remoteUptoPaymentMiddleware>;
};

/**
 * Build the MiddlewareOptions that wire the settlement hooks to a recorder.
 * Only attach the hooks when a KV binding exists — otherwise return `undefined`
 * so the middleware fires nothing and recording is a true no-op (no in-memory
 * accumulation in production isolates without KV).
 */
function buildSettlementOptions(env: Bindings): MiddlewareOptions | undefined {
  if (!env.SETTLEMENTS) return undefined;
  const recorder: SettlementRecorder = createKvRecorder(env.SETTLEMENTS);
  return {
    onSettlementIntent: (intent) => recorder.recordIntent(intent),
    onSettlementResult: (outcome) => recorder.recordResult(outcome),
  };
}

function buildDeps(env: Bindings): Deps {
  const network = NETWORK_MAP[env.NETWORK];
  if (!network) throw new Error(`Unknown network: ${env.NETWORK}`);
  const middleware = remoteUptoPaymentMiddleware(
    buildRoutes(network),
    env.FACILITATOR_URL,
    env.FACILITATOR_ADDRESS,
    undefined,
    buildSettlementOptions(env),
  );
  return Object.freeze({ middleware });
}

/** Build the Hono app, closing over an immutable `Deps` record. */
export function createApp(env: Bindings): Hono<Env> {
  const deps = buildDeps(env);
  const a = new Hono<Env>();

  // Edge hardening runs first: CORS, then security headers (HSTS, no-sniff,
  // frame-deny, conservative referrer), then per-IP rate limiting on the free
  // discovery / health routes.
  a.use("/*", corsMiddleware);
  a.use("/*", secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "no-referrer",
  }));
  a.use("/health", rateLimitFree);
  a.use("/models", rateLimitFree);
  a.use("/llms.txt", rateLimitFree);
  a.use("/.well-known/*", rateLimitFree);

  a.get("/", (c) => {
    const accept = c.req.header("Accept") ?? "";
    if (accept.includes("text/html")) {
      const modelRows = Object.entries(MODELS)
        .map(([k, v]) => `<tr><td><code>POST /${k}</code></td><td>${v.description}</td><td>${v.maxPrice}</td><td><code>${v.model}</code></td></tr>`)
        .join("\n");
      return c.html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>infer.x402cloud.ai — AI Inference via x402 Protocol</title>
<meta name="description" content="AI inference using the x402 protocol standard. OpenAI-compatible. Pay per token with USDC.">
<meta property="og:title" content="infer.x402cloud.ai"><meta property="og:description" content="AI inference using the x402 protocol standard. OpenAI-compatible. Pay per token with USDC.">
<meta property="og:image" content="https://x402cloud.ai/og.png"><meta name="twitter:card" content="summary_large_image">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#060606;--surface:#0a0a0a;--border:#222;--bd:#2a2a2a;--text:#d4d4d4;--bright:#ececec;--mid:#8a8a8a;--dim:#555;--mono:"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;--sans:"Inter",-apple-system,sans-serif}
body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased;font-size:15px}
a{color:inherit;text-decoration:none}a:hover{color:var(--bright)}
nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(6,6,6,0.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
nav .inner{max-width:1080px;margin:0 auto;padding:0 32px;height:52px;display:flex;align-items:center;justify-content:space-between}
.wordmark{font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:0.04em;color:var(--bright)}
.nav-links{display:flex;gap:24px}
.nav-links a{font-family:var(--mono);font-size:12px;color:var(--mid);letter-spacing:0.02em;transition:color .15s}
.nav-links a:hover{color:var(--bright)}
.w{max-width:900px;margin:0 auto;padding:80px 32px;padding-top:100px}
h1{font-size:36px;font-weight:700;color:var(--bright);letter-spacing:-0.03em;margin-bottom:8px}
.sub{font-size:17px;color:var(--mid);margin-bottom:40px}
.links{display:flex;gap:16px;margin-bottom:48px;flex-wrap:wrap}
.links a{font-family:var(--mono);font-size:12px;color:var(--mid);border:1px solid var(--border);padding:6px 14px;transition:all .15s}
.links a:hover{color:var(--bright);border-color:var(--dim)}
h2{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--dim);margin-bottom:16px;margin-top:48px}
table{width:100%;border-collapse:collapse;border:1px solid var(--border);font-size:13px}
th{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);text-align:left;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface)}
td{padding:10px 16px;border-bottom:1px solid var(--border);color:var(--mid)}
td:first-child{color:var(--bright)}
code{font-family:var(--mono);font-size:12px}
.code-block{background:var(--surface);border:1px solid var(--border);padding:20px;font-family:var(--mono);font-size:12.5px;line-height:2;color:var(--mid);overflow-x:auto;margin-bottom:24px;white-space:pre}
.info{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);margin-bottom:24px}
.info-item{padding:16px 20px;border-right:1px dashed var(--bd);border-bottom:1px dashed var(--bd)}
.info-item:nth-child(2n){border-right:none}
.info-label{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin-bottom:4px}
.info-value{font-size:14px;color:var(--bright)}
footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--border);font-family:var(--mono);font-size:12px;color:var(--dim);display:flex;gap:24px}
footer a{color:var(--dim);transition:color .15s}footer a:hover{color:var(--mid)}
@media(max-width:600px){.w{padding:48px 20px;padding-top:80px}h1{font-size:28px}.info{grid-template-columns:1fr}.info-item{border-right:none}nav .inner{padding:0 20px}}
</style></head><body>
<nav><div class="inner"><a href="https://x402cloud.ai" class="wordmark">x402cloud.ai</a><div class="nav-links"><a href="https://x402cloud.ai/#services">Services</a><a href="https://x402cloud.ai/#packages">Packages</a><a href="https://status.x402cloud.ai">Status</a><a href="https://github.com/x402cloud/x402cloud">GitHub</a><a href="https://x402cloud.ai/llms.txt">Docs</a></div></div></nav>
<div class="w">
<h1>infer.x402cloud.ai</h1>
<p class="sub">AI inference using the x402 protocol standard. No signup. No API keys. Pay per token with USDC on Base.</p>
<div class="links">
<a href="/models">Models API</a>
<a href="/llms.txt">llms.txt</a>
<a href="https://x402cloud.ai/llms.txt">Full Docs</a>
<a href="https://x402.org">x402 Standard</a>
<a href="https://github.com/x402cloud/x402cloud">GitHub</a>
</div>

<div class="info">
<div class="info-item"><div class="info-label">Payment</div><div class="info-value">x402 upto (USDC on Base)</div></div>
<div class="info-item"><div class="info-label">Recipient</div><div class="info-value"><code>${SERVER_ADDRESS.slice(0, 6)}...${SERVER_ADDRESS.slice(-4)}</code></div></div>
<div class="info-item"><div class="info-label">Format</div><div class="info-value">OpenAI chat completions</div></div>
<div class="info-item"><div class="info-label">Runtime</div><div class="info-value">Cloudflare Workers AI</div></div>
</div>

<h2>Models</h2>
<table>
<tr><th>Endpoint</th><th>Description</th><th>Max Price</th><th>Model</th></tr>
${modelRows}
</table>

<h2>Example Request</h2>
<div class="code-block">curl -X POST https://infer.x402cloud.ai/fast \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Hello"}]}'

# Returns 402 → pay with @x402cloud/client to auto-handle payment</div>

<h2>OpenAI-Compatible</h2>
<div class="code-block"># Point any OpenAI client at the /v1 base — POST /v1/chat/completions works.
curl -X POST https://infer.x402cloud.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'

# /v1/embeddings, /v1/images/generations and GET /v1/models also supported.
# Returns 402 → same x402 payment flow as the short-name routes.</div>

<footer>
<a href="https://x402cloud.ai">x402cloud.ai</a>
<a href="https://x402cloud.ai/llms.txt">docs</a>
<a href="https://github.com/x402cloud/x402cloud">github</a>
</footer>
</div></body></html>`);
    }

    return c.json({
      name: "infer.x402cloud.ai",
      description: "AI inference using the x402 protocol standard. No signup. No API keys.",
      docs: "https://infer.x402cloud.ai/llms.txt",
      models_url: "https://infer.x402cloud.ai/models",
      payment: "x402 upto (USDC on Base)",
      recipient: SERVER_ADDRESS,
      client_sdk: "npm install @x402cloud/client",
      x402_standard: "https://x402.org",
      models: Object.fromEntries(
        Object.entries(MODELS).map(([k, v]) => [
          k,
          { maxPrice: v.maxPrice, description: v.description, endpoint: `/${k}` },
        ])
      ),
    });
  });

  a.get("/health", (c) => c.json({ status: "ok" }));

  // Model listing — both the native and OpenAI-compatible paths. Free.
  a.get("/models", (c) => c.json(toOpenAIModelList(MODELS)));
  a.get("/v1/models", (c) => c.json(toOpenAIModelList(MODELS)));

  // Standard discovery surface: /openapi.json, /agents.json, /llms.txt,
  // /robots.txt, /sitemap.xml, /.well-known/agent-card.json, /.well-known/api-catalog.
  mountDiscovery(a, DISCOVERY_META, DISCOVERY_ROUTES, { skills: DISCOVERY_SKILLS });

  // Payment middleware (instance built once for this isolate, not per request).
  a.use("/*", (c, next) => deps.middleware(c, next));

  // Run a handler with uniform 500 error wrapping. Shared by short-name and
  // OpenAI-compatible routes so inference logic is never duplicated.
  const runHandler = async (c: Context<Env>, name: string) => {
    try {
      return await HANDLERS[MODELS[name].type](c, name);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "infer-error";
      return c.json({ error: message }, 500);
    }
  };

  // Paid short-name routes (data-driven): POST /fast, /smart, ...
  for (const name of Object.keys(MODELS)) {
    a.post(`/${name}`, (c) => runHandler(c, name));
  }

  // Paid OpenAI-compatible routes: resolve the model from the request body,
  // then reuse the SAME handler. The payment middleware above has already
  // verified payment (these paths are in buildRoutes), so this is never free.
  for (const endpoint of OPENAI_ENDPOINTS) {
    a.post(endpoint.path, async (c) => {
      const body = await c.req.raw.clone().json().catch(() => ({}));
      const name = resolveModel(body, endpoint);
      return runHandler(c, name);
    });
  }

  return a;
}

// --- Worker default export ---
//
// A single cached Hono instance per isolate, keyed by env.

let cache: { readonly app: Hono<Env>; readonly key: string } | null = null;

function depsKey(env: Bindings): string {
  return `${env.NETWORK}|${env.FACILITATOR_URL}|${env.FACILITATOR_ADDRESS}`;
}

function getApp(env: Bindings): Hono<Env> {
  const key = depsKey(env);
  if (!cache || cache.key !== key) {
    cache = Object.freeze({ app: createApp(env), key });
  }
  return cache.app;
}

// The Worker entry. `fetch` is what wrangler invokes; `request` mirrors
// Hono's test helper so existing tests `await app.request(path, init, env)`
// continue to work without modification. Both route through the same
// per-isolate cached `createApp(env)` instance.
const app = {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    return getApp(env).fetch(request, env, ctx);
  },
  request(
    input: string | Request,
    init?: RequestInit,
    env?: Bindings,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    if (!env) throw new Error("env required for app.request() in tests");
    return Promise.resolve(getApp(env).request(input, init, env, ctx));
  },
};

export { buildRoutes, NETWORK_MAP, HANDLERS, SERVER_ADDRESS, buildSettlementOptions };
export default app;
