import type { Hono } from "hono";
import type { ServiceMeta, ServiceRoute, ServiceSkill } from "./types.js";
import {
  buildAgentCard,
  buildAgentsJson,
  buildApiCatalog,
  buildLlmsTxt,
  buildOpenApi,
  buildRobotsTxt,
  buildSitemapXml,
  defaultSitemapPaths,
  routeToSkill,
} from "./builders.js";

export type MountDiscoveryOptions = {
  /** Override the skill list for the agent-card. Defaults to one skill per paid route. */
  skills?: ServiceSkill[];
  /** Override the sitemap path list. Defaults to `defaultSitemapPaths(routes)`. */
  sitemapPaths?: string[];
  /** Override the facilitator url surfaced in `openapi.json#x-x402`. */
  facilitator?: string;
};

/**
 * Mount the full standard discovery surface on a Hono app:
 *
 *   GET /openapi.json
 *   GET /agents.json
 *   GET /llms.txt
 *   GET /robots.txt
 *   GET /sitemap.xml
 *   GET /.well-known/agent-card.json
 *   GET /.well-known/api-catalog
 *
 * Builders are pure; this adapter only converts their output into Hono
 * Responses. Apps keep their bespoke `/` (marketing HTML) and `/health` routes
 * — those aren't standard discovery.
 */
export function mountDiscovery<E extends Record<string, unknown>>(
  // We accept `any` Hono generics here so callers don't have to widen their app type.
  // The runtime behaviour is identical for every Hono variant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: Hono<any>,
  meta: ServiceMeta,
  routes: ServiceRoute[],
  options: MountDiscoveryOptions = {},
): Hono<E extends Record<string, unknown> ? any : any> {
  const skills =
    options.skills ?? routes.filter((r) => r.payment).map(routeToSkill);
  const sitemapPaths = options.sitemapPaths ?? defaultSitemapPaths(routes);

  app.get("/openapi.json", (c) =>
    c.json(buildOpenApi(meta, routes, options.facilitator)),
  );
  app.get("/agents.json", (c) => c.json(buildAgentsJson(meta, routes)));
  app.get("/llms.txt", (c) => c.text(buildLlmsTxt(meta, routes)));
  app.get("/robots.txt", (c) => c.text(buildRobotsTxt(meta.baseUrl)));
  app.get("/sitemap.xml", (c) =>
    c.text(buildSitemapXml(meta.baseUrl, sitemapPaths), 200, {
      "Content-Type": "application/xml",
    }),
  );
  app.get("/.well-known/agent-card.json", (c) =>
    c.json(buildAgentCard(meta, skills)),
  );
  app.get("/.well-known/api-catalog", (c) => c.json(buildApiCatalog(meta)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return app as any;
}
