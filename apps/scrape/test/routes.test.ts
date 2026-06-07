import { describe, it, expect } from "vitest";
import app, { MAX_PRICE, buildRoutes, ROUTES } from "../src/index.js";

const ENV = {
  BROWSER: {} as Fetcher,
  NETWORK: "eip155:84532",
  FACILITATOR_URL: "https://facilitator.x402cloud.ai",
  OPERATOR_ADDRESS: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
};

describe("free routes", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health", {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /.well-known/agent-card.json is valid JSON with both skills", async () => {
    const res = await app.request("/.well-known/agent-card.json", {}, ENV);
    expect(res.status).toBe(200);
    const card = (await res.json()) as { skills: { id: string }[] };
    const ids = card.skills.map((s) => s.id);
    expect(ids).toContain("page");
    expect(ids).toContain("screenshot");
  });

  it("GET /openapi.json lists /page and /screenshot", async () => {
    const res = await app.request("/openapi.json", {}, ENV);
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/page"]).toBeDefined();
    expect(spec.paths["/screenshot"]).toBeDefined();
  });
});

describe("paid routes without payment header", () => {
  it("POST /page returns 402", async () => {
    const res = await app.request(
      "/page",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      ENV,
    );
    expect(res.status).toBe(402);
  });

  it("POST /screenshot returns 402", async () => {
    const res = await app.request(
      "/screenshot",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      ENV,
    );
    expect(res.status).toBe(402);
  });
});

describe("buildRoutes", () => {
  it("emits one route per ROUTE entry with the catalog maxPrice", () => {
    const routes = buildRoutes("eip155:84532", ENV.OPERATOR_ADDRESS);
    expect(Object.keys(routes).sort()).toEqual(["POST /page", "POST /screenshot"]);
    for (const route of Object.values(routes)) {
      expect(route.maxPrice).toBe(MAX_PRICE);
      expect(route.payTo).toBe(ENV.OPERATOR_ADDRESS);
      expect(route.network).toBe("eip155:84532");
      expect(typeof route.meter).toBe("function");
    }
    expect(Object.keys(ROUTES)).toEqual(["page", "screenshot"]);
  });
});
