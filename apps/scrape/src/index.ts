import { Hono, type Context } from "hono";
import { remoteUptoPaymentMiddleware } from "@x402cloud/middleware";
import type { UptoRoutesConfig } from "@x402cloud/middleware";
import type { ServiceMeta, ServiceRoute, ServiceSkill } from "@x402cloud/discovery";
import { mountDiscovery } from "@x402cloud/discovery/hono";
import { scrapeEntries } from "@x402cloud/manifests";
import { createMeter } from "./meter.js";
import {
  createDefaultRenderDeps,
  initRenderDeps,
  renderMarkdown,
  renderScreenshot,
  FetchFailedError,
  ScrapeTimeoutError,
  type PageRequest,
  type RenderDeps,
  type ScreenshotRequest,
} from "./handler.js";

type Bindings = {
  BROWSER: Fetcher;
  NETWORK: string;
  FACILITATOR_URL: string;
  /** Settlement wallet address of the facilitator (its /supported `facilitator` field). Advertised to clients as `extra.facilitator` — the canonical upto witness binds it. */
  FACILITATOR_ADDRESS: `0x${string}`;
  OPERATOR_ADDRESS: string;
};

type Env = { Bindings: Bindings };

const BASE_URL = "https://scrape.x402cloud.ai";

/**
 * Per-route prices come from `@x402cloud/manifests` — the same module the
 * marketplace catalog reads. Two consumers, one source. `MAX_PRICE` is the
 * shared retail ceiling across the scrape routes (they share a wholesale
 * pricing model).
 */
function manifestEntries(network: `${string}:${string}`, payTo: string) {
  return scrapeEntries({
    network,
    asset: "0x0000000000000000000000000000000000000000",
    payTo,
    facilitator: "https://facilitator.x402cloud.ai",
    baseUrl: BASE_URL,
  });
}

const MAX_PRICE = manifestEntries("eip155:84532", "0x0000000000000000000000000000000000000000")[0]?.maxPrice ?? "$0.000000";

/**
 * Route specs as data. Adding a route = adding a row, never modifying a
 * dispatch tree.
 */
type RouteSpec = {
  description: string;
  example: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  outputMode: string;
};

const ROUTES: Readonly<Record<string, RouteSpec>> = Object.freeze({
  page: {
    description: "Fetch a URL, render it with a headless browser, return clean markdown.",
    example: { url: "https://example.com", waitFor: "networkidle" },
    responseSchema: {
      type: "object",
      properties: {
        markdown: { type: "string" },
        title: { type: "string" },
        url: { type: "string" },
        durationMs: { type: "integer" },
      },
    },
    outputMode: "application/json",
  },
  screenshot: {
    description: "Take a full-page PNG screenshot of any URL.",
    example: { url: "https://example.com", fullPage: true },
    responseSchema: { type: "string", format: "binary" },
    outputMode: "image/png",
  },
});

function buildRoutes(network: `${string}:${string}`, payTo: string): UptoRoutesConfig {
  const routes: UptoRoutesConfig = {};
  const priceByPath = new Map(
    manifestEntries(network, payTo).map((e) => [e.path, e.maxPrice]),
  );
  for (const [name, spec] of Object.entries(ROUTES)) {
    const path = `/${name}`;
    routes[`POST ${path}`] = {
      network,
      maxPrice: priceByPath.get(path) ?? MAX_PRICE,
      payTo,
      maxTimeoutSeconds: 60,
      description: spec.description,
      meter: createMeter(),
    };
  }
  return routes;
}

// --- Discovery routes (mounted via @x402cloud/discovery) ---

const PAGE_REQUEST_SCHEMA = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string", format: "uri" },
    waitFor: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
    waitMs: { type: "integer", maximum: 30000 },
  },
};
const SCREENSHOT_REQUEST_SCHEMA = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string", format: "uri" },
    fullPage: { type: "boolean" },
    waitFor: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
    waitMs: { type: "integer", maximum: 30000 },
  },
};

const DISCOVERY_META: ServiceMeta = {
  name: "scrape.x402cloud.ai",
  description: "Headless-browser scraping with x402 micropayments.",
  baseUrl: BASE_URL,
  defaultOutputModes: Array.from(new Set(Object.values(ROUTES).map((r) => r.outputMode))),
};

const DISCOVERY_ROUTES: ServiceRoute[] = [
  {
    path: "/page",
    method: "POST",
    operationId: "scrapePage",
    summary: ROUTES.page.description,
    tags: ["scrape"],
    kind: "scrape",
    payment: { maxPrice: MAX_PRICE, network: "Base (USDC)" },
    requestSchema: PAGE_REQUEST_SCHEMA,
    responseSchema: ROUTES.page.responseSchema,
    extraResponses: {
      "408": { description: "Scrape timed out" },
      "502": { description: "Navigation failed" },
    },
    examples: [`POST ${BASE_URL}/page with ${JSON.stringify(ROUTES.page.example)}`],
  },
  {
    path: "/screenshot",
    method: "POST",
    operationId: "scrapeScreenshot",
    summary: ROUTES.screenshot.description,
    tags: ["scrape"],
    kind: "scrape",
    payment: { maxPrice: MAX_PRICE, network: "Base (USDC)" },
    requestSchema: SCREENSHOT_REQUEST_SCHEMA,
    responseSchema: ROUTES.screenshot.responseSchema,
    responseContentType: "image/png",
    extraResponses: {
      "408": { description: "Scrape timed out" },
      "502": { description: "Navigation failed" },
    },
    examples: [`POST ${BASE_URL}/screenshot with ${JSON.stringify(ROUTES.screenshot.example)}`],
  },
];

const DISCOVERY_SKILLS: ServiceSkill[] = Object.entries(ROUTES).map(([id, spec]) => ({
  id,
  name: `${id} scrape`,
  description: spec.description,
  tags: ["scrape", "browser", id, "x402"],
  examples: [`POST ${BASE_URL}/${id} with ${JSON.stringify(spec.example)}`],
}));

// --- Deps: immutable per-isolate projection of env ---

type Deps = {
  readonly middleware: ReturnType<typeof remoteUptoPaymentMiddleware>;
  readonly renderDeps: RenderDeps;
};

function buildDeps(env: Bindings): Deps {
  if (!env.NETWORK.startsWith("eip155:")) {
    throw new Error(`NETWORK must be eip155:<chainId>, got: ${env.NETWORK}`);
  }
  const middleware = remoteUptoPaymentMiddleware(
    buildRoutes(env.NETWORK as `${string}:${string}`, env.OPERATOR_ADDRESS),
    env.FACILITATOR_URL,
    env.FACILITATOR_ADDRESS,
  );
  return Object.freeze({ middleware, renderDeps: createDefaultRenderDeps() });
}

/** Build the Hono app, closing over an immutable `Deps` record. */
export function createApp(env: Bindings): Hono<Env> {
  const deps = buildDeps(env);
  const a = new Hono<Env>();

  a.get("/", (c) => {
    const accept = c.req.header("Accept") ?? "";
    if (accept.includes("text/html")) {
      const rows = Object.entries(ROUTES)
        .map(([k, v]) => `<tr><td><code>POST /${k}</code></td><td>${v.description}</td><td>${MAX_PRICE}</td></tr>`)
        .join("\n");
      return c.html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><title>scrape.x402cloud.ai</title>
<meta name="description" content="Render any URL to markdown or PNG with a headless browser. Pay per request with USDC.">
</head><body>
<h1>scrape.x402cloud.ai</h1>
<p>Render any URL to markdown or PNG with a headless browser. Pay per request with USDC on Base.</p>
<table><tr><th>Endpoint</th><th>Description</th><th>Max Price</th></tr>${rows}</table>
</body></html>`);
    }
    return c.json({
      name: "scrape.x402cloud.ai",
      description: "Headless-browser scraping using the x402 protocol standard.",
      docs: `${BASE_URL}/llms.txt`,
      payment: "x402 upto (USDC on Base)",
      endpoints: Object.keys(ROUTES),
    });
  });

  a.get("/health", (c) => c.json({ status: "ok" }));

  mountDiscovery(a, DISCOVERY_META, DISCOVERY_ROUTES, { skills: DISCOVERY_SKILLS });

  // Payment middleware (instance built once for this isolate, not per request).
  a.use("/*", (c, next) => deps.middleware(c, next));

  // Paid handlers.
  a.post("/page", async (c: Context<Env>) => {
    let body: PageRequest;
    try {
      body = (await c.req.json()) as PageRequest;
    } catch {
      return c.json({ error: "invalid-json" }, 400);
    }
    if (typeof body?.url !== "string" || body.url.length === 0) {
      return c.json({ error: "missing-url" }, 400);
    }

    try {
      await initRenderDeps(deps.renderDeps);
      const result = await renderMarkdown(c.env.BROWSER, body, deps.renderDeps);
      return c.json(result);
    } catch (e) {
      if (e instanceof ScrapeTimeoutError) {
        return c.json({ error: "scrape-timeout", durationMs: e.durationMs }, 408);
      }
      if (e instanceof FetchFailedError) {
        return c.json({ error: "fetch-failed", reason: e.reason }, 502);
      }
      const message = e instanceof Error ? e.message : "scrape-error";
      return c.json({ error: message }, 500);
    }
  });

  a.post("/screenshot", async (c: Context<Env>) => {
    let body: ScreenshotRequest;
    try {
      body = (await c.req.json()) as ScreenshotRequest;
    } catch {
      return c.json({ error: "invalid-json" }, 400);
    }
    if (typeof body?.url !== "string" || body.url.length === 0) {
      return c.json({ error: "missing-url" }, 400);
    }

    try {
      await initRenderDeps(deps.renderDeps);
      const { png, durationMs } = await renderScreenshot(c.env.BROWSER, body, deps.renderDeps);
      // Copy into a fresh ArrayBuffer — Response's BodyInit accepts ArrayBuffer
      // but not Uint8Array in the workers-types signature.
      const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "X-Scrape-Duration-Ms": durationMs.toString(),
        },
      });
    } catch (e) {
      if (e instanceof ScrapeTimeoutError) {
        return c.json({ error: "scrape-timeout", durationMs: e.durationMs }, 408);
      }
      if (e instanceof FetchFailedError) {
        return c.json({ error: "fetch-failed", reason: e.reason }, 502);
      }
      const message = e instanceof Error ? e.message : "scrape-error";
      return c.json({ error: message }, 500);
    }
  });

  return a;
}

// --- Worker default export ---
//
// A single cached Hono instance per isolate, keyed by env. Identity (the
// cached app reference) is isolated from state (no state lives in the app
// after construction).

let cache: { readonly app: Hono<Env>; readonly key: string } | null = null;

function depsKey(env: Bindings): string {
  return `${env.NETWORK}|${env.FACILITATOR_URL}|${env.FACILITATOR_ADDRESS}|${env.OPERATOR_ADDRESS}`;
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

export { buildRoutes, MAX_PRICE, BASE_URL, ROUTES };
export default app;
