import { describe, it, expect } from "vitest";
import {
  MODEL_ALIASES,
  OPENAI_ENDPOINTS,
  resolveModel,
  candidateModels,
  endpointMaxPrice,
  type OpenAIEndpoint,
} from "../src/openai.js";
import { MODELS } from "../src/models.js";
import { buildRoutes } from "../src/index.js";
import app from "../src/index.js";

const CHAT: OpenAIEndpoint = OPENAI_ENDPOINTS.find((e) => e.path === "/v1/chat/completions")!;
const EMBED: OpenAIEndpoint = OPENAI_ENDPOINTS.find((e) => e.path === "/v1/embeddings")!;
const IMAGE: OpenAIEndpoint = OPENAI_ENDPOINTS.find((e) => e.path === "/v1/images/generations")!;

const ENV = {
  AI: {} as never,
  NETWORK: "base-sepolia",
  FACILITATOR_URL: "https://facilitator.test",
};

describe("MODEL_ALIASES", () => {
  it("maps OpenAI chat names to internal text models", () => {
    expect(MODELS[MODEL_ALIASES["gpt-4o-mini"]]?.type).toBe("text");
    expect(MODELS[MODEL_ALIASES["gpt-4o"]]?.type).toBe("text");
  });

  it("maps the service's own short names (identity)", () => {
    for (const key of Object.keys(MODELS)) {
      expect(MODEL_ALIASES[key], `short name ${key} should alias to itself`).toBe(key);
    }
  });

  it("every alias target is a real model", () => {
    for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
      expect(MODELS[target], `alias ${alias} -> ${target} must exist`).toBeDefined();
    }
  });
});

describe("resolveModel", () => {
  it("resolves an OpenAI name to its internal model at the matching endpoint", () => {
    expect(resolveModel({ model: "gpt-4o" }, CHAT)).toBe(MODEL_ALIASES["gpt-4o"]);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveModel({ model: "  GPT-4O-MINI  " }, CHAT)).toBe(MODEL_ALIASES["gpt-4o-mini"]);
  });

  it("resolves short names", () => {
    expect(resolveModel({ model: "smart" }, CHAT)).toBe("smart");
  });

  it("falls back to the endpoint default for unknown models", () => {
    expect(resolveModel({ model: "no-such-model" }, CHAT)).toBe(CHAT.defaultModel);
    expect(resolveModel({}, CHAT)).toBe(CHAT.defaultModel);
    expect(resolveModel(null, CHAT)).toBe(CHAT.defaultModel);
  });

  it("rejects a model of the wrong kind and falls back to the endpoint default", () => {
    // "embed" is a valid alias but its kind is embed, not text — chat endpoint must not route to it.
    expect(resolveModel({ model: "embed" }, CHAT)).toBe(CHAT.defaultModel);
    // and an embed endpoint must not route to a text model
    expect(resolveModel({ model: "fast" }, EMBED)).toBe(EMBED.defaultModel);
  });

  it("always resolves to a model of the endpoint's kind", () => {
    for (const endpoint of OPENAI_ENDPOINTS) {
      const name = resolveModel({ model: "whatever" }, endpoint);
      expect(MODELS[name].type).toBe(endpoint.kind);
    }
  });
});

describe("endpointMaxPrice / candidateModels", () => {
  it("candidate models all share the endpoint's kind", () => {
    for (const endpoint of OPENAI_ENDPOINTS) {
      for (const key of candidateModels(endpoint)) {
        expect(MODELS[key].type).toBe(endpoint.kind);
      }
    }
  });

  it("quotes the largest maxPrice across candidate models (a ceiling)", () => {
    const candidates = candidateModels(CHAT);
    const quoted = endpointMaxPrice(CHAT);
    for (const key of candidates) {
      const cand = parseFloat(MODELS[key].maxPrice.replace("$", ""));
      const ceil = parseFloat(quoted.replace("$", ""));
      expect(ceil).toBeGreaterThanOrEqual(cand);
    }
    // The ceiling must actually be one of the candidate prices.
    const candPrices = candidates.map((k) => MODELS[k].maxPrice);
    expect(candPrices).toContain(quoted);
  });
});

describe("buildRoutes includes OpenAI-compatible paid routes", () => {
  it("adds a paid route for every OpenAI endpoint with a meter", () => {
    const routes = buildRoutes("eip155:84532");
    for (const endpoint of OPENAI_ENDPOINTS) {
      const route = routes[`POST ${endpoint.path}`];
      expect(route, `missing route for ${endpoint.path}`).toBeDefined();
      expect(route.maxPrice).toBe(endpointMaxPrice(endpoint));
      expect(typeof route.meter).toBe("function");
    }
  });
});

describe("OpenAI routes are paid (no free bypass)", () => {
  it("POST /v1/chat/completions returns 402 without payment", async () => {
    const res = await app.request(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      },
      ENV,
    );
    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  });

  it("POST /v1/embeddings returns 402 without payment", async () => {
    const res = await app.request(
      "/v1/embeddings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: "hello" }),
      },
      ENV,
    );
    expect(res.status).toBe(402);
  });

  it("POST /v1/images/generations returns 402 without payment", async () => {
    const res = await app.request(
      "/v1/images/generations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "dall-e-3", prompt: "a cat" }),
      },
      ENV,
    );
    expect(res.status).toBe(402);
  });
});

describe("GET /v1/models is free and OpenAI-shaped", () => {
  it("returns a model list without payment", async () => {
    const res = await app.request("/v1/models", { method: "GET" }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; data: { id: string }[] };
    expect(body.object).toBe("list");
    const ids = body.data.map((m) => m.id);
    for (const key of Object.keys(MODELS)) {
      expect(ids).toContain(key);
    }
  });
});
