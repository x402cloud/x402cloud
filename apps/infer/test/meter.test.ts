import { describe, it, expect } from "vitest";
import { createMeter } from "../src/meter.js";
import { MODELS } from "../src/models.js";
import {
  computeTextCost,
  computeEmbedCost,
  computeImageCost,
} from "../src/pricing.js";

const PAYER = "0x0000000000000000000000000000000000000001";

function toMicro(cost: number): string {
  return Math.round(cost * 1e6).toString();
}

function makeRequest(body: unknown): Request {
  return new Request("https://infer.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createMeter", () => {
  it("throws for unknown model", () => {
    expect(() => createMeter("not-a-real-model")).toThrow(/Unknown model/);
  });

  it("image model returns flat per-generation cost", async () => {
    const meter = createMeter("image");
    const cost = await meter({
      request: makeRequest({ prompt: "a cat" }),
      response: makeResponse({ image: "base64..." }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    expect(cost).toBe(toMicro(computeImageCost()));
  });

  it("embed model estimates input tokens from `input` field", async () => {
    const meter = createMeter("embed");
    const text = "hello world"; // 11 chars -> ceil(11/4) = 3 tokens
    const cost = await meter({
      request: makeRequest({ input: text }),
      response: makeResponse({ data: [] }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = toMicro(computeEmbedCost(MODELS.embed.neurons, 3));
    expect(cost).toBe(expected);
  });

  it("embed model sums tokens across array input", async () => {
    const meter = createMeter("embed");
    const cost = await meter({
      request: makeRequest({ input: ["abcd", "efgh"] }), // 1 + 1 tokens
      response: makeResponse({}),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = toMicro(computeEmbedCost(MODELS.embed.neurons, 2));
    expect(cost).toBe(expected);
  });

  it("embed model handles missing input body gracefully", async () => {
    const meter = createMeter("embed");
    const cost = await meter({
      request: new Request("https://infer.test/", { method: "POST", body: "not json" }),
      response: makeResponse({}),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    // 0 tokens -> BASE_FEE only
    const expected = toMicro(computeEmbedCost(MODELS.embed.neurons, 0));
    expect(cost).toBe(expected);
  });

  it("text model prefers usage fields when provided", async () => {
    const meter = createMeter("fast");
    const cost = await meter({
      request: makeRequest({ messages: [{ role: "user", content: "hi" }] }),
      response: makeResponse({
        choices: [{ message: { content: "hello back" } }],
        usage: { prompt_tokens: 123, completion_tokens: 456 },
      }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = toMicro(computeTextCost(MODELS.fast.neurons, 123, 456));
    expect(cost).toBe(expected);
  });

  it("text model falls back to char estimation when usage missing", async () => {
    const meter = createMeter("nano");
    const inputText = "hello"; // 5 chars -> ceil(5/4) = 2 tokens
    const outputText = "hi there"; // 8 chars -> 2 tokens
    const cost = await meter({
      request: makeRequest({ messages: [{ role: "user", content: inputText }] }),
      response: makeResponse({ response: outputText }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    const expected = toMicro(computeTextCost(MODELS.nano.neurons, 2, 2));
    expect(cost).toBe(expected);
  });

  it("text model extracts output from choices[].message.content", async () => {
    const meter = createMeter("nano");
    const cost = await meter({
      request: makeRequest({ messages: [{ role: "user", content: "a" }] }),
      response: makeResponse({
        choices: [{ message: { content: "abcd" } }],
      }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    // input "a" -> 1 token, output "abcd" -> 1 token
    const expected = toMicro(computeTextCost(MODELS.nano.neurons, 1, 1));
    expect(cost).toBe(expected);
  });

  it("caps cost at authorizedAmount", async () => {
    const meter = createMeter("big");
    const cost = await meter({
      request: makeRequest({
        messages: [{ role: "user", content: "x".repeat(10_000) }],
      }),
      response: makeResponse({
        usage: { prompt_tokens: 100_000, completion_tokens: 100_000 },
      }),
      authorizedAmount: "1", // 1 micro-USDC, obviously less than any real cost
      payer: PAYER,
    });
    expect(cost).toBe("1");
  });

  it("ignores partial usage (only one of prompt/completion)", async () => {
    const meter = createMeter("nano");
    const cost = await meter({
      request: makeRequest({ messages: [{ role: "user", content: "abcd" }] }),
      response: makeResponse({
        response: "wxyz",
        usage: { prompt_tokens: 999 }, // missing completion_tokens
      }),
      authorizedAmount: "1000000000",
      payer: PAYER,
    });
    // Should fall back to char estimation: 1 + 1
    const expected = toMicro(computeTextCost(MODELS.nano.neurons, 1, 1));
    expect(cost).toBe(expected);
  });
});
