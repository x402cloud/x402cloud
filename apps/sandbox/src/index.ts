import { Hono, type Context } from "hono";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";
import type { UptoRoutesConfig } from "@x402cloud/middleware";
import type { ServiceMeta, ServiceRoute } from "@x402cloud/discovery";
import { mountDiscovery } from "@x402cloud/discovery/hono";
import { sandboxEntries } from "@x402cloud/manifests";
import { createMeter } from "./meter.js";
import {
  RUNTIMES,
  runCode,
  SandboxTimeoutError,
  createDefaultRunDeps,
  initRunDeps,
  type ExecRequest,
  type RunDeps,
  type Runtime,
  type SandboxBinding,
} from "./handler.js";

type Bindings = {
  Sandbox: SandboxBinding;
  NETWORK: string;
  FACILITATOR_URL: string;
  OPERATOR_ADDRESS: string;
};

type Env = { Bindings: Bindings };

const BASE_URL = "https://sandbox.x402cloud.ai";

/**
 * Per-route prices come from `@x402cloud/manifests` — the same module the
 * marketplace catalog reads. Two consumers, one source. `MAX_PRICE` is the
 * common retail ceiling across sandbox runtimes (they share a wholesale
 * pricing model).
 */
function manifestEntries(network: `${string}:${string}`, payTo: string) {
  return sandboxEntries({
    network,
    asset: "0x0000000000000000000000000000000000000000",
    payTo,
    facilitator: "https://facilitator.x402cloud.ai",
    baseUrl: BASE_URL,
  });
}

const MAX_PRICE = manifestEntries("eip155:84532", "0x0000000000000000000000000000000000000000")[0]?.maxPrice ?? "$0.000000";

function buildRoutes(network: `${string}:${string}`, payTo: string): UptoRoutesConfig {
  const routes: UptoRoutesConfig = {};
  for (const entry of manifestEntries(network, payTo)) {
    const name = entry.path.slice(1);
    routes[`POST ${entry.path}`] = {
      network,
      maxPrice: entry.maxPrice,
      payTo,
      maxTimeoutSeconds: 60,
      description: `Run ${name} code in an isolated sandbox`,
      meter: createMeter(),
    };
  }
  return routes;
}

// --- Free / discovery routes (mirrors apps/infer surface) ---

const EXEC_REQUEST_SCHEMA = {
  type: "object",
  required: ["code"],
  properties: {
    code: { type: "string" },
    timeout: { type: "integer", default: 10000, maximum: 30000 },
    stdin: { type: "string" },
  },
};
const EXEC_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    stdout: { type: "string" },
    stderr: { type: "string" },
    exitCode: { type: "integer" },
    durationMs: { type: "integer" },
  },
};

const DISCOVERY_META: ServiceMeta = {
  name: "sandbox.x402cloud.ai",
  description: "Isolated code execution sandbox with x402 micropayments.",
  baseUrl: BASE_URL,
};

const DISCOVERY_ROUTES: ServiceRoute[] = Object.keys(RUNTIMES).map((name) => ({
  path: `/${name}`,
  method: "POST",
  operationId: `run-${name}`,
  summary: `Run ${name} code in an isolated sandbox`,
  tags: ["sandbox"],
  kind: "sandbox",
  payment: { maxPrice: MAX_PRICE, network: "Base (USDC)" },
  requestSchema: EXEC_REQUEST_SCHEMA,
  responseSchema: EXEC_RESPONSE_SCHEMA,
  extraResponses: { "408": { description: "Sandbox execution timed out" } },
  examples: [`POST ${BASE_URL}/${name} with {"code":"print('hello')"}`],
}));

// --- Deps: immutable per-isolate projection of env ---

type Deps = {
  readonly middleware: ReturnType<typeof remoteUptoPaymentMiddleware>;
  readonly runDeps: RunDeps;
};

function buildDeps(env: Bindings): Deps {
  if (!env.NETWORK.startsWith("eip155:")) {
    throw new Error(`NETWORK must be eip155:<chainId>, got: ${env.NETWORK}`);
  }
  const middleware = remoteUptoPaymentMiddleware(
    buildRoutes(env.NETWORK as `${string}:${string}`, env.OPERATOR_ADDRESS),
    env.FACILITATOR_URL,
  );
  return Object.freeze({ middleware, runDeps: createDefaultRunDeps() });
}

/** Build the Hono app, closing over an immutable `Deps` record. */
export function createApp(env: Bindings): Hono<Env> {
  const deps = buildDeps(env);
  const a = new Hono<Env>();

  a.get("/", (c) => {
    const accept = c.req.header("Accept") ?? "";
    if (accept.includes("text/html")) {
      const rows = Object.keys(RUNTIMES)
        .map((k) => `<tr><td><code>POST /${k}</code></td><td>${k} sandbox</td><td>${MAX_PRICE}</td></tr>`)
        .join("\n");
      return c.html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><title>sandbox.x402cloud.ai</title>
<meta name="description" content="Run untrusted Python or Node code in an isolated sandbox. Pay per second with USDC.">
</head><body>
<h1>sandbox.x402cloud.ai</h1>
<p>Run untrusted Python or Node code in an isolated sandbox. Pay per second with USDC on Base.</p>
<table><tr><th>Endpoint</th><th>Runtime</th><th>Max Price</th></tr>${rows}</table>
</body></html>`);
    }
    return c.json({
      name: "sandbox.x402cloud.ai",
      description: "Isolated code execution sandbox using the x402 protocol standard.",
      docs: `${BASE_URL}/llms.txt`,
      payment: "x402 upto (USDC on Base)",
      runtimes: Object.keys(RUNTIMES),
    });
  });

  a.get("/health", (c) => c.json({ status: "ok" }));

  mountDiscovery(a, DISCOVERY_META, DISCOVERY_ROUTES);

  // Payment middleware (instance built once for this isolate, not per request).
  a.use("/*", (c, next) => deps.middleware(c, next));

  // Paid handler (one branch per runtime, driven by RUNTIMES data).
  async function handle(c: Context<Env>, runtime: Runtime): Promise<Response> {
    let body: ExecRequest;
    try {
      body = (await c.req.json()) as ExecRequest;
    } catch {
      return c.json({ error: "invalid-json" }, 400);
    }
    if (typeof body?.code !== "string" || body.code.length === 0) {
      return c.json({ error: "missing-code" }, 400);
    }

    // One sandbox per (runtime, payment) — sandbox IDs are per-request; the SDK
    // sleeps idle containers after 10 minutes.
    const sandboxId = `${runtime}-${crypto.randomUUID()}`;

    try {
      await initRunDeps(deps.runDeps);
      const result = await runCode(c.env.Sandbox, runtime, body, sandboxId, deps.runDeps);
      return c.json(result);
    } catch (e) {
      if (e instanceof SandboxTimeoutError) {
        return c.json({ error: "sandbox-timeout", durationMs: e.durationMs }, 408);
      }
      const message = e instanceof Error ? e.message : "sandbox-error";
      return c.json({ error: message }, 500);
    }
  }

  for (const name of Object.keys(RUNTIMES) as Runtime[]) {
    a.post(`/${name}`, (c) => handle(c, name));
  }

  return a;
}

// --- Worker default export ---
//
// A single cached Hono instance per isolate. The cache key is derived from
// env so a change (e.g. NETWORK swap on redeploy) rebuilds rather than
// silently serving stale config. The cached value is an immutable Hono app —
// identity, not mutable per-request state.

let cache: { readonly app: Hono<Env>; readonly key: string } | null = null;

function depsKey(env: Bindings): string {
  return `${env.NETWORK}|${env.FACILITATOR_URL}|${env.OPERATOR_ADDRESS}`;
}

function getApp(env: Bindings): Hono<Env> {
  const key = depsKey(env);
  if (!cache || cache.key !== key) {
    cache = Object.freeze({ app: createApp(env), key });
  }
  return cache.app;
}

// The default export must expose `request()` so tests can call
// `app.request(path, init, env)`. We wrap the per-isolate cache in a thin
// Hono whose only middleware delegates to the cached inner app — this keeps
// the test surface identical to a normal Hono app.
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

export { buildRoutes, MAX_PRICE, BASE_URL };
export default app;
