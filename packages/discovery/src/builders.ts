import type {
  PaymentInfo,
  ServiceMeta,
  ServiceRoute,
  ServiceSkill,
} from "./types.js";

const DEFAULT_VERSION = "1.0.0";
const DEFAULT_PROTOCOL = "a2a";
const DEFAULT_INPUT_MODES = ["application/json"];
const DEFAULT_OUTPUT_MODES = ["application/json"];
const DEFAULT_RESPONSE_CT = "application/json";

function paidRoutes(routes: ServiceRoute[]): ServiceRoute[] {
  return routes.filter((r) => r.payment !== undefined);
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** A2A-style agent card. Derived from meta + skills (skills usually one-per-paid-route). */
export function buildAgentCard(
  meta: ServiceMeta,
  skills: ServiceSkill[],
): Record<string, unknown> {
  return {
    name: meta.name,
    description: meta.description,
    url: meta.baseUrl,
    version: meta.version ?? DEFAULT_VERSION,
    protocol: meta.protocol ?? DEFAULT_PROTOCOL,
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    authentication: {
      schemes: ["x402"],
      description: "Payment via x402 protocol (USDC on Base). No API keys required.",
    },
    defaultInputModes: meta.defaultInputModes ?? DEFAULT_INPUT_MODES,
    defaultOutputModes: meta.defaultOutputModes ?? DEFAULT_OUTPUT_MODES,
    skills,
  };
}

/** OpenAPI 3.1 doc. Each `ServiceRoute` becomes one path/method. */
export function buildOpenApi(
  meta: ServiceMeta,
  routes: ServiceRoute[],
  facilitator?: string,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const r of routes) {
    const op: Record<string, unknown> = {
      operationId: r.operationId ?? defaultOperationId(r),
      summary: r.summary,
      tags: r.tags ?? (r.payment ? ["paid"] : ["free"]),
    };

    if (r.payment) {
      const x402: Record<string, unknown> = {
        maxPrice: r.payment.maxPrice,
        network: r.payment.network,
      };
      if (r.payment.payTo) x402.payTo = r.payment.payTo;
      op["x-x402"] = x402;
    }

    if (r.method === "POST" && r.requestSchema) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: r.requestSchema } },
      };
    }

    const responses: Record<string, unknown> = {};
    const ct = r.responseContentType ?? DEFAULT_RESPONSE_CT;
    responses["200"] = r.responseSchema
      ? {
          description: r.summary,
          content: { [ct]: { schema: r.responseSchema } },
        }
      : {
          description: r.summary,
          content: { [ct]: { schema: { type: "object" } } },
        };

    if (r.payment) {
      responses["402"] = {
        description: "Payment required — include x402 payment header",
      };
    }
    if (r.extraResponses) {
      for (const [code, body] of Object.entries(r.extraResponses)) {
        responses[code] = body;
      }
    }
    op.responses = responses;

    paths[r.path] = { ...(paths[r.path] ?? {}), [r.method.toLowerCase()]: op };
  }

  const facilitatorUrl = facilitator ?? meta.facilitator;

  const doc: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: meta.name,
      version: meta.version ?? DEFAULT_VERSION,
      description: meta.description,
      contact: { url: meta.contactUrl ?? "https://x402cloud.ai" },
    },
    servers: [{ url: meta.baseUrl, description: "Production" }],
    paths,
  };

  const paid = paidRoutes(routes);
  if (paid.length > 0) {
    const first = paid[0].payment!;
    doc["x-x402"] = {
      protocol: "x402 upto",
      network: first.network,
      currency: "USDC",
      ...(first.payTo ? { recipient: first.payTo } : {}),
      ...(facilitatorUrl ? { facilitator: facilitatorUrl } : {}),
    };
  }

  return doc;
}

function defaultOperationId(r: ServiceRoute): string {
  const slug = r.path.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return `${r.method.toLowerCase()}-${slug || "root"}`;
}

/** agents.json — a lightweight directory used by some agent harnesses. */
export function buildAgentsJson(
  meta: ServiceMeta,
  routes: ServiceRoute[],
): Record<string, unknown> {
  const endpoints = routes
    .filter((r) => r.payment)
    .map((r) => ({
      name: r.path.replace(/^\//, ""),
      url: `${meta.baseUrl}${r.path}`,
      method: r.method,
      type: r.kind ?? r.tags?.[0] ?? "endpoint",
      description: r.summary,
      pricing: {
        maxPrice: r.payment!.maxPrice,
        currency: "USDC",
        network: r.payment!.network,
        protocol: "x402 upto",
      },
    }));

  const auth: Record<string, unknown> = {
    type: "x402",
    currency: "USDC",
  };
  const first = routes.find((r) => r.payment)?.payment;
  if (first) {
    auth.network = first.network;
    if (first.payTo) auth.recipient = first.payTo;
  }

  return {
    schema_version: "1.0",
    name: meta.name,
    description: meta.shortDescription ?? meta.description,
    url: meta.baseUrl,
    openapi: `${meta.baseUrl}/openapi.json`,
    authentication: auth,
    endpoints,
  };
}

/** llms.txt — markdown-ish service description aimed at LLMs. */
export function buildLlmsTxt(meta: ServiceMeta, routes: ServiceRoute[]): string {
  const lines: string[] = [];
  lines.push(`# ${meta.name}`);
  lines.push("");
  lines.push(meta.description);
  lines.push("");
  lines.push("## Endpoints");
  for (const r of routes) {
    const price = r.payment ? ` — ${r.payment.maxPrice} max per call` : "";
    lines.push(`- ${r.method} ${r.path} — ${r.summary}${price}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** RFC 9727 API catalog (linkset). */
export function buildApiCatalog(meta: ServiceMeta): Record<string, unknown> {
  return {
    linkset: [
      {
        anchor: meta.baseUrl,
        "service-desc": [
          { href: `${meta.baseUrl}/openapi.json`, type: "application/openapi+json" },
          { href: `${meta.baseUrl}/llms.txt`, type: "text/plain" },
        ],
      },
    ],
  };
}

/** Sitemap XML. Caller passes the absolute path list (e.g. ["/", "/health", ...]). */
export function buildSitemapXml(baseUrl: string, paths: string[]): string {
  const urls = uniq(paths)
    .map((p) => `  <url><loc>${baseUrl}${p}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

/** robots.txt that allows everything and points at the sitemap. */
export function buildRobotsTxt(baseUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
}

/** Derive a default skill from a paid route. Helps apps that have one-skill-per-route. */
export function routeToSkill(r: ServiceRoute): ServiceSkill {
  const id = r.path.replace(/^\//, "");
  return {
    id,
    name: r.summary,
    description: r.summary,
    tags: uniq([...(r.tags ?? []), "x402"]),
    examples: r.examples,
  };
}

/** Compute the default sitemap path list from a service description. */
export function defaultSitemapPaths(routes: ServiceRoute[]): string[] {
  const fixed = [
    "/",
    "/health",
    "/llms.txt",
    "/openapi.json",
    "/agents.json",
    "/.well-known/agent-card.json",
    "/.well-known/api-catalog",
  ];
  return uniq([...fixed, ...routes.map((r) => r.path)]);
}

export type { PaymentInfo, ServiceMeta, ServiceRoute, ServiceSkill };
