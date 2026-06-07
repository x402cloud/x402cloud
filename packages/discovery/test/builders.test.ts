import { describe, expect, it } from "vitest";
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
  type ServiceMeta,
  type ServiceRoute,
} from "../src/index.js";

const meta: ServiceMeta = {
  name: "infer.x402cloud.ai",
  description: "AI inference via x402.",
  baseUrl: "https://infer.x402cloud.ai",
  facilitator: "https://facilitator.x402cloud.ai",
};

const paidRoute: ServiceRoute = {
  path: "/fast",
  method: "POST",
  summary: "Fast LLM",
  tags: ["text"],
  payment: {
    maxPrice: "$0.001",
    network: "Base (USDC)",
    payTo: "0xabc",
  },
  requestSchema: { type: "object", properties: { messages: { type: "array" } } },
  responseSchema: { type: "object" },
};

const freeRoute: ServiceRoute = {
  path: "/models",
  method: "GET",
  summary: "List models",
};

describe("buildOpenApi", () => {
  it("emits openapi 3.1 with info, servers, paths", () => {
    const doc = buildOpenApi(meta, [paidRoute, freeRoute]);
    expect(doc.openapi).toBe("3.1.0");
    expect((doc.info as Record<string, unknown>).title).toBe(meta.name);
    expect((doc.servers as Array<{ url: string }>)[0].url).toBe(meta.baseUrl);
    expect(Object.keys(doc.paths as object)).toEqual(
      expect.arrayContaining(["/fast", "/models"]),
    );
  });

  it("attaches x-x402 only to paid routes", () => {
    const doc = buildOpenApi(meta, [paidRoute, freeRoute]);
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/fast"].post["x-x402"]).toMatchObject({
      maxPrice: "$0.001",
      network: "Base (USDC)",
      payTo: "0xabc",
    });
    expect(paths["/models"].get["x-x402"]).toBeUndefined();
  });

  it("emits 402 response for paid routes and not for free ones", () => {
    const doc = buildOpenApi(meta, [paidRoute, freeRoute]);
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    const paidResponses = paths["/fast"].post.responses as Record<string, unknown>;
    const freeResponses = paths["/models"].get.responses as Record<string, unknown>;
    expect(paidResponses["402"]).toBeDefined();
    expect(freeResponses["402"]).toBeUndefined();
  });

  it("includes top-level x-x402 with facilitator when any paid route exists", () => {
    const doc = buildOpenApi(meta, [paidRoute]);
    expect(doc["x-x402"]).toMatchObject({
      protocol: "x402 upto",
      facilitator: "https://facilitator.x402cloud.ai",
      recipient: "0xabc",
    });
  });
});

describe("buildAgentCard", () => {
  it("includes meta, protocol default and skills", () => {
    const card = buildAgentCard(meta, [routeToSkill(paidRoute)]);
    expect(card.name).toBe(meta.name);
    expect(card.url).toBe(meta.baseUrl);
    expect(card.protocol).toBe("a2a");
    expect((card.authentication as { schemes: string[] }).schemes).toContain("x402");
    expect((card.skills as Array<{ id: string }>).length).toBe(1);
    expect((card.skills as Array<{ id: string }>)[0].id).toBe("fast");
  });
});

describe("buildAgentsJson", () => {
  it("lists only paid endpoints, attaches pricing", () => {
    const j = buildAgentsJson(meta, [paidRoute, freeRoute]);
    const endpoints = j.endpoints as Array<{ name: string; pricing: { maxPrice: string } }>;
    expect(endpoints.length).toBe(1);
    expect(endpoints[0].name).toBe("fast");
    expect(endpoints[0].pricing.maxPrice).toBe("$0.001");
    expect(j.openapi).toBe(`${meta.baseUrl}/openapi.json`);
  });
});

describe("buildLlmsTxt", () => {
  it("renders one line per route with price for paid ones", () => {
    const txt = buildLlmsTxt(meta, [paidRoute, freeRoute]);
    expect(txt).toContain(`# ${meta.name}`);
    expect(txt).toContain("POST /fast");
    expect(txt).toContain("$0.001 max per call");
    expect(txt).toContain("GET /models");
    expect(txt).not.toMatch(/GET \/models.*\$/);
  });
});

describe("buildApiCatalog", () => {
  it("emits an RFC9727 linkset", () => {
    const c = buildApiCatalog(meta);
    const linkset = c.linkset as Array<{ anchor: string; "service-desc": Array<{ href: string }> }>;
    expect(linkset[0].anchor).toBe(meta.baseUrl);
    expect(linkset[0]["service-desc"].map((d) => d.href)).toEqual(
      expect.arrayContaining([
        `${meta.baseUrl}/openapi.json`,
        `${meta.baseUrl}/llms.txt`,
      ]),
    );
  });
});

describe("buildSitemapXml + buildRobotsTxt", () => {
  it("sitemap contains each path exactly once, prefixed by baseUrl", () => {
    const xml = buildSitemapXml(meta.baseUrl, ["/", "/health", "/"]);
    expect(xml).toContain("<?xml");
    expect(xml).toContain(`<loc>${meta.baseUrl}/</loc>`);
    expect(xml).toContain(`<loc>${meta.baseUrl}/health</loc>`);
    // de-duped
    expect(xml.match(/<loc>https:\/\/infer.x402cloud.ai\/<\/loc>/g)?.length).toBe(1);
  });

  it("robots points at the sitemap", () => {
    const r = buildRobotsTxt(meta.baseUrl);
    expect(r).toContain(`Sitemap: ${meta.baseUrl}/sitemap.xml`);
    expect(r).toContain("Allow: /");
  });
});

describe("defaultSitemapPaths", () => {
  it("includes the standard discovery + every route, deduped", () => {
    const paths = defaultSitemapPaths([paidRoute, freeRoute, paidRoute]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/health",
        "/llms.txt",
        "/openapi.json",
        "/agents.json",
        "/.well-known/agent-card.json",
        "/.well-known/api-catalog",
        "/fast",
        "/models",
      ]),
    );
    expect(paths.filter((p) => p === "/fast").length).toBe(1);
  });
});
