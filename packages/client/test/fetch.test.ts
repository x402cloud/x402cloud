import { describe, it, expect, vi, beforeEach } from "vitest";
import { wrapFetchWithPayment } from "../src/fetch.js";
import type { PaymentClientConfig, SchemeHandler } from "../src/types.js";
import type { ClientSigner } from "@x402cloud/evm";

// Mock @x402cloud/protocol
vi.mock("@x402cloud/protocol", () => ({
  decodeRequirementsHeader: vi.fn((header: string) => JSON.parse(atob(header))),
  encodePaymentHeader: vi.fn((payload: unknown) => btoa(JSON.stringify(payload))),
}));

// Mock @x402cloud/evm
vi.mock("@x402cloud/evm", () => ({
  createUptoPayload: vi.fn(async () => ({ signature: "0xmock", permit2Authorization: {} })),
}));

const mockSigner: ClientSigner = {
  address: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
  signTypedData: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
};

function makePaymentRequired(opts?: { accepts?: unknown[]; x402Version?: number }) {
  return {
    x402Version: opts?.x402Version ?? 2,
    resource: { url: "https://api.example.com/data" },
    accepts: opts?.accepts ?? [
      {
        scheme: "upto",
        network: "eip155:8453",
        asset: "0xUSDC",
        maxAmount: "100000",
        payTo: "0xRecipient",
        maxTimeoutSeconds: 300,
      },
    ],
  };
}

function encode402Header(paymentRequired: unknown): string {
  return btoa(JSON.stringify(paymentRequired));
}

describe("wrapFetchWithPayment", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.restoreAllMocks();
  });

  it("returns response directly when status is not 402", async () => {
    const mockResponse = new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    globalThis.fetch = vi.fn(async () => mockResponse);

    const config: PaymentClientConfig = { signer: mockSigner };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    globalThis.fetch = originalFetch;
  });

  it("handles 402 with PAYMENT-REQUIRED header and retries", async () => {
    const paymentRequired = makePaymentRequired();
    const encoded = encode402Header(paymentRequired);

    const response402 = new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encoded },
    });
    const response200 = new Response(JSON.stringify({ result: "paid" }), { status: 200 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response402)
      .mockResolvedValueOnce(response200);
    globalThis.fetch = fetchMock;

    const config: PaymentClientConfig = { signer: mockSigner };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify second call includes PAYMENT-SIGNATURE header
    const retryCall = fetchMock.mock.calls[1];
    const retryInit = retryCall[1] as RequestInit;
    const headers = retryInit.headers as Record<string, string>;
    expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();

    globalThis.fetch = originalFetch;
  });

  it("handles 402 from JSON body when no PAYMENT-REQUIRED header", async () => {
    const paymentRequired = makePaymentRequired();

    const response402 = new Response(JSON.stringify(paymentRequired), {
      status: 402,
    });
    const response200 = new Response(JSON.stringify({ result: "paid" }), { status: 200 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response402)
      .mockResolvedValueOnce(response200);
    globalThis.fetch = fetchMock;

    const config: PaymentClientConfig = { signer: mockSigner };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    globalThis.fetch = originalFetch;
  });

  it("respects maxRetries and stops retrying after limit", async () => {
    const paymentRequired = makePaymentRequired();
    const encoded = encode402Header(paymentRequired);

    const make402 = () =>
      new Response(null, {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encoded },
      });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make402())
      .mockResolvedValueOnce(make402())
      .mockResolvedValueOnce(make402());
    globalThis.fetch = fetchMock;

    const config: PaymentClientConfig = { signer: mockSigner, maxRetries: 2 };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(402);
    // 1 initial + 2 retries = 3 total
    expect(fetchMock).toHaveBeenCalledTimes(3);

    globalThis.fetch = originalFetch;
  });

  it("breaks if no payment options in response (empty accepts)", async () => {
    const paymentRequired = makePaymentRequired({ accepts: [] });
    const encoded = encode402Header(paymentRequired);

    const response402 = new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encoded },
    });

    const fetchMock = vi.fn().mockResolvedValueOnce(response402);
    globalThis.fetch = fetchMock;

    const config: PaymentClientConfig = { signer: mockSigner };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(402);
    // Should only call fetch once, no retry
    expect(fetchMock).toHaveBeenCalledTimes(1);

    globalThis.fetch = originalFetch;
  });

  it("breaks if scheme handler is not found", async () => {
    const paymentRequired = makePaymentRequired({
      accepts: [
        {
          scheme: "unknown-scheme",
          network: "eip155:8453",
          asset: "0xUSDC",
          maxAmount: "100000",
          payTo: "0xRecipient",
          maxTimeoutSeconds: 300,
        },
      ],
    });
    const encoded = encode402Header(paymentRequired);

    const response402 = new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encoded },
    });

    const fetchMock = vi.fn().mockResolvedValueOnce(response402);
    globalThis.fetch = fetchMock;

    const config: PaymentClientConfig = { signer: mockSigner };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    globalThis.fetch = originalFetch;
  });

  it("uses custom schemeHandlers when provided", async () => {
    const paymentRequired = makePaymentRequired({
      accepts: [
        {
          scheme: "custom",
          network: "eip155:8453",
          asset: "0xUSDC",
          maxAmount: "100000",
          payTo: "0xRecipient",
          maxTimeoutSeconds: 300,
        },
      ],
    });
    const encoded = encode402Header(paymentRequired);

    const response402 = new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encoded },
    });
    const response200 = new Response(JSON.stringify({ result: "custom-paid" }), { status: 200 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response402)
      .mockResolvedValueOnce(response200);
    globalThis.fetch = fetchMock;

    const customHandler: SchemeHandler = vi.fn(async () => ({
      customSignature: "0xcustom",
    }));

    const config: PaymentClientConfig = {
      signer: mockSigner,
      schemeHandlers: { custom: customHandler },
    };
    const paymentFetch = wrapFetchWithPayment(config);

    const res = await paymentFetch("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(customHandler).toHaveBeenCalledOnce();

    globalThis.fetch = originalFetch;
  });

  it("preserves existing headers when retrying with payment", async () => {
    const paymentRequired = makePaymentRequired();
    const encoded = encode402Header(paymentRequired);

    const response402 = new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encoded },
    });
    const response200 = new Response("ok", { status: 200 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response402)
      .mockResolvedValueOnce(response200);
    globalThis.fetch = fetchMock;

    const config: PaymentClientConfig = { signer: mockSigner };
    const paymentFetch = wrapFetchWithPayment(config);

    await paymentFetch("https://api.example.com/data", {
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    });

    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = retryInit.headers as Record<string, string>;
    // Headers constructor lowercases keys
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer token");
    expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();

    globalThis.fetch = originalFetch;
  });
});
