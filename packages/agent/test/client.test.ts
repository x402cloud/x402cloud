import { describe, it, expect, vi } from "vitest";
import { createAgentClient } from "../src/client.js";
import { ServiceNotFoundError, BudgetExceededError } from "../src/types.js";
import type { BudgetTracker } from "../src/budget.js";
import type { ClientSigner } from "@x402cloud/evm";

const CATALOG_URL = "https://marketplace.example.com";

const mockSigner: ClientSigner = {
  address: "0x1111111111111111111111111111111111111111",
  signTypedData: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
};

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAgentClient.discover", () => {
  it("returns services from catalog endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        version: "0.1.0",
        generatedAt: "now",
        operator: { name: "x", url: "x", payTo: "0x" },
        services: [svc],
      }),
    );
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: fetchMock,
    });
    const services = await agent.discover({ category: "inference" });
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("infer-fast");
  });
});

describe("createAgentClient.getService", () => {
  it("throws ServiceNotFoundError when id is unknown", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 404 }));
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: fetchMock,
    });
    await expect(agent.getService("missing")).rejects.toBeInstanceOf(
      ServiceNotFoundError,
    );
  });
});

describe("createAgentClient.fetchFor", () => {
  it("resolves the service and returns a fetch function", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(svc));
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: fetchMock,
    });
    const f = await agent.fetchFor("infer-fast");
    expect(typeof f).toBe("function");
  });

  it("throws ServiceNotFoundError when id is unknown", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 404 }));
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: fetchMock,
    });
    await expect(agent.fetchFor("nope")).rejects.toBeInstanceOf(
      ServiceNotFoundError,
    );
  });
});

describe("createAgentClient.call", () => {
  it("looks up the service, POSTs JSON body, returns parsed JSON", async () => {
    // catalog fetch is via opts.fetch; payingFetch uses globalThis.fetch.
    const catalogFetch = vi.fn(async () => jsonResponse(svc));
    const originalFetch = globalThis.fetch;
    const upstreamResponse = jsonResponse({ ok: true, answer: 42 });
    globalThis.fetch = vi.fn(async () => upstreamResponse) as typeof fetch;

    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
    });

    const result = await agent.call<{ ok: boolean; answer: number }>(
      "infer-fast",
      { prompt: "hi" },
    );
    expect(result).toEqual({ ok: true, answer: 42 });

    // verify upstream call shape
    const upstreamCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(upstreamCall[0]).toBe(svc.endpoint.url);
    expect((upstreamCall[1] as RequestInit).method).toBe("POST");
    expect((upstreamCall[1] as RequestInit).body).toBe(
      JSON.stringify({ prompt: "hi" }),
    );

    globalThis.fetch = originalFetch;
  });

  it("throws ServiceNotFoundError on unknown id", async () => {
    const catalogFetch = vi.fn(async () => new Response("x", { status: 404 }));
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
    });
    await expect(agent.call("missing", {})).rejects.toBeInstanceOf(
      ServiceNotFoundError,
    );
  });

  it("surfaces upstream non-2xx verbatim with status on the error", async () => {
    const catalogFetch = vi.fn(async () => jsonResponse(svc));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response("upstream is sad", { status: 502 }),
    ) as typeof fetch;

    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
    });

    try {
      await agent.call("infer-fast", {});
      throw new Error("expected throw");
    } catch (e) {
      const err = e as Error & { status?: number; body?: string };
      expect(err.status).toBe(502);
      expect(err.body).toBe("upstream is sad");
      expect(err.message).toContain("502");
    }

    globalThis.fetch = originalFetch;
  });

  it("records settled amount from X-Payment-Settled header (not maxPrice)", async () => {
    const catalogFetch = vi.fn(async () => jsonResponse(svc)); // maxPrice $0.01
    const originalFetch = globalThis.fetch;
    // Server settled for 1234 micro-USDC = $0.001234
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "X-Payment-Settled": "1234",
      },
    });
    globalThis.fetch = vi.fn(async () => upstream) as typeof fetch;

    const recorded: number[] = [];
    const tracker: BudgetTracker = {
      check: () => {},
      record: (n) => recorded.push(n),
      spentToday: () => 0,
    };
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
      tracker,
    });

    await agent.call("infer-fast", {});
    expect(recorded).toEqual([0.001234]);

    globalThis.fetch = originalFetch;
  });

  it("falls back to maxPrice when X-Payment-Settled header missing", async () => {
    const catalogFetch = vi.fn(async () => jsonResponse(svc)); // maxPrice $0.01
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;

    const recorded: number[] = [];
    const tracker: BudgetTracker = {
      check: () => {},
      record: (n) => recorded.push(n),
      spentToday: () => 0,
    };
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
      tracker,
    });

    await agent.call("infer-fast", {});
    expect(recorded).toEqual([0.01]);

    globalThis.fetch = originalFetch;
  });

  it("uses caller-supplied tracker over inline budget", async () => {
    const catalogFetch = vi.fn(async () => jsonResponse(svc));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;

    const calls: string[] = [];
    const tracker: BudgetTracker = {
      check: (id) => { calls.push(`check:${id}`); },
      record: () => { calls.push("record"); },
      spentToday: () => 0,
    };
    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
      budget: { perCall: "$0.0001" }, // would block if used — but custom tracker takes precedence
      tracker,
    });

    await agent.call("infer-fast", {});
    expect(calls).toEqual(["check:infer-fast", "record"]);

    globalThis.fetch = originalFetch;
  });

  it("enforces perCall budget cap before paying", async () => {
    const catalogFetch = vi.fn(async () => jsonResponse(svc)); // maxPrice $0.01
    const originalFetch = globalThis.fetch;
    const upstreamSpy = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = upstreamSpy as typeof fetch;

    const agent = createAgentClient({
      signer: mockSigner,
      catalogUrl: CATALOG_URL,
      fetch: catalogFetch,
      budget: { perCall: "$0.001" }, // cap below maxPrice
    });

    await expect(agent.call("infer-fast", {})).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(upstreamSpy).not.toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });
});
