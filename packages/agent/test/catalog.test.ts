import { describe, it, expect, vi } from "vitest";
import { fetchCatalog, fetchService } from "../src/catalog.js";

const CATALOG_URL = "https://marketplace.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const svc = {
  id: "infer-fast",
  category: "inference",
  name: "Infer Fast",
  description: "Quick LLM",
  endpoint: { method: "POST", url: "https://infer.example.com/v1" },
  payment: {
    protocol: "x402",
    scheme: "upto",
    network: "eip155:84532",
    asset: "0xUSDC",
    maxPrice: "$0.01",
    payTo: "0xPAY",
    facilitator: "https://facilitator.example.com",
  },
  tags: ["llm"],
};

describe("fetchCatalog", () => {
  it("hits /services and returns the services array", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        version: "0.1.0",
        generatedAt: "now",
        operator: { name: "x", url: "x", payTo: "0x" },
        services: [svc],
      }),
    );
    const services = await fetchCatalog(CATALOG_URL, undefined, fetchMock);
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("infer-fast");
    expect(fetchMock.mock.calls[0][0]).toBe(`${CATALOG_URL}/services`);
  });

  it("forwards filter params on the URL", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        version: "0.1.0",
        generatedAt: "now",
        operator: { name: "x", url: "x", payTo: "0x" },
        services: [],
      }),
    );
    await fetchCatalog(
      CATALOG_URL,
      { category: "inference", tag: "llm", q: "fast" },
      fetchMock,
    );
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("category=inference");
    expect(calledUrl).toContain("tag=llm");
    expect(calledUrl).toContain("q=fast");
  });

  it("throws on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(fetchCatalog(CATALOG_URL, undefined, fetchMock)).rejects.toThrow(
      /500/,
    );
  });
});

describe("fetchService", () => {
  it("returns the service on 200", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(svc));
    const got = await fetchService(CATALOG_URL, "infer-fast", fetchMock);
    expect(got?.id).toBe("infer-fast");
  });

  it("returns null on 404", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 404 }));
    const got = await fetchService(CATALOG_URL, "missing", fetchMock);
    expect(got).toBeNull();
  });

  it("throws on other non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 502 }));
    await expect(
      fetchService(CATALOG_URL, "bad", fetchMock),
    ).rejects.toThrow(/502/);
  });
});
