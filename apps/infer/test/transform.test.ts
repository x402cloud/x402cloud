import { describe, it, expect } from "vitest";
import {
  toOpenAIChatResponse,
  toOpenAIEmbeddingResponse,
  toOpenAIModelList,
  toLlmsTxt,
} from "../src/transform.js";

describe("toOpenAIChatResponse", () => {
  const id = "chatcmpl-test123";
  const created = 1700000000;

  it("handles string result", () => {
    const res = toOpenAIChatResponse("Hello world", "fast", id, created);
    expect(res.id).toBe(id);
    expect(res.object).toBe("chat.completion");
    expect(res.model).toBe("fast");
    expect(res.created).toBe(created);
    expect(res.choices[0].message.content).toBe("Hello world");
    expect(res.choices[0].finish_reason).toBe("stop");
  });

  it("handles structured result with choices", () => {
    const result = {
      choices: [{ message: { content: "Structured response" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const res = toOpenAIChatResponse(result, "smart", id, created);
    expect(res.choices[0].message.content).toBe("Structured response");
    expect(res.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
  });

  it("handles result with .response field", () => {
    const result = { response: "Response field" };
    const res = toOpenAIChatResponse(result, "nano", id, created);
    expect(res.choices[0].message.content).toBe("Response field");
  });

  it("falls back to empty string for missing content", () => {
    const res = toOpenAIChatResponse({}, "fast", id, created);
    expect(res.choices[0].message.content).toBe("");
  });

  it("provides default usage when missing", () => {
    const res = toOpenAIChatResponse("test", "fast", id, created);
    expect(res.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });
});

describe("toOpenAIEmbeddingResponse", () => {
  it("wraps data array", () => {
    const result = { data: [[0.1, 0.2], [0.3, 0.4]] };
    const res = toOpenAIEmbeddingResponse(result, "embed");
    expect(res.object).toBe("list");
    expect(res.data).toHaveLength(2);
    expect(res.data[0].embedding).toEqual([0.1, 0.2]);
    expect(res.data[1].index).toBe(1);
    expect(res.model).toBe("embed");
  });

  it("wraps single embedding", () => {
    const result = { embedding: [0.5, 0.6] };
    const res = toOpenAIEmbeddingResponse(result, "embed");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].embedding).toEqual([0.5, 0.6]);
  });

  it("handles empty result", () => {
    const res = toOpenAIEmbeddingResponse({}, "embed");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].embedding).toEqual([]);
  });
});

describe("toOpenAIModelList", () => {
  it("formats model list", () => {
    const models = {
      fast: { model: "@cf/meta/llama", type: "text" as const, description: "Fast model", neurons: { inputPerMillion: 0, outputPerMillion: 0 }, maxPrice: "$0.01" },
    };
    const res = toOpenAIModelList(models);
    expect(res.object).toBe("list");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("fast");
    expect(res.data[0].owned_by).toBe("x402cloud");
    expect(res.data[0].cf_model).toBe("@cf/meta/llama");
  });
});

describe("toLlmsTxt", () => {
  it("includes permissionless messaging", () => {
    const models = {
      fast: { model: "@cf/meta/llama", type: "text" as const, description: "Fast", neurons: { inputPerMillion: 0, outputPerMillion: 0 }, maxPrice: "$0.01" },
    };
    const txt = toLlmsTxt(models, "0xABC");
    expect(txt).toContain("x402 protocol standard");
    expect(txt).toContain("No signup");
    expect(txt).toContain("No API keys");
    expect(txt).toContain("@x402cloud/client");
    expect(txt).toContain("x402.org");
    expect(txt).toContain("/fast");
    expect(txt).toContain("0xABC");
  });
});
