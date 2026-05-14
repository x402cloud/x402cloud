import { Hono, type Context } from "hono";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";
import type { UptoRoutesConfig } from "@x402cloud/middleware";
import type { ServiceMeta, ServiceRoute, ServiceSkill } from "@x402cloud/discovery";
import { mountDiscovery } from "@x402cloud/discovery/hono";
import { MODELS, type ModelType } from "./models.js";
import { createMeter } from "./meter.js";
import {
  toOpenAIChatResponse,
  toOpenAIEmbeddingResponse,
  toOpenAIModelList,
  type ChatResult,
  type EmbeddingResult,
} from "./transform.js";

const BASE_URL = "https://infer.x402cloud.ai";

type Bindings = {
  AI: Ai;
  NETWORK: string;
  FACILITATOR_URL: string;
};

type Env = { Bindings: Bindings };

const SERVER_ADDRESS = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88";

const NETWORK_MAP: Record<string, `${string}:${string}`> = {
  "base":         "eip155:8453",
  "base-sepolia": "eip155:84532",
  "ethereum":     "eip155:1",
  "arbitrum":     "eip155:42161",
  "optimism":     "eip155:10",
  "polygon":      "eip155:137",
};

// --- Route config ---

function buildRoutes(network: `${string}:${string}`): UptoRoutesConfig {
  const routes: UptoRoutesConfig = {};
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

const DISCOVERY_ROUTES: ServiceRoute[] = [
  { path: "/models", method: "GET", summary: "List available models", tags: ["free"] },
  { path: "/llms.txt", method: "GET", summary: "LLM-readable documentation", tags: ["free"], responseContentType: "text/plain", responseSchema: { type: "string" } },
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

// --- Deps: immutable per-isolate projection of env ---

type Deps = {
  readonly middleware: ReturnType<typeof remoteUptoPaymentMiddleware>;
};

function buildDeps(env: Bindings): Deps {
  const network = NETWORK_MAP[env.NETWORK];
  if (!network) throw new Error(`Unknown network: ${env.NETWORK}`);
  const middleware = remoteUptoPaymentMiddleware(buildRoutes(network), env.FACILITATOR_URL);
  return Object.freeze({ middleware });
}

/** Build the Hono app, closing over an immutable `Deps` record. */
export function createApp(env: Bindings): Hono<Env> {
  const deps = buildDeps(env);
  const a = new Hono<Env>();

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

  a.get("/models", (c) => c.json(toOpenAIModelList(MODELS)));

  mountDiscovery(a, DISCOVERY_META, DISCOVERY_ROUTES, { skills: DISCOVERY_SKILLS });

  // Payment middleware (instance built once for this isolate, not per request).
  a.use("/*", (c, next) => deps.middleware(c, next));

  // Paid routes (data-driven).
  for (const [name, config] of Object.entries(MODELS)) {
    const handler = HANDLERS[config.type];
    a.post(`/${name}`, async (c) => {
      try {
        return await handler(c, name);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "infer-error";
        return c.json({ error: message }, 500);
      }
    });
  }

  return a;
}

// --- Worker default export ---
//
// A single cached Hono instance per isolate, keyed by env.

let cache: { readonly app: Hono<Env>; readonly key: string } | null = null;

function depsKey(env: Bindings): string {
  return `${env.NETWORK}|${env.FACILITATOR_URL}`;
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

export { buildRoutes, NETWORK_MAP, HANDLERS, SERVER_ADDRESS };
export default app;
