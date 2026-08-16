import { describe, it, expect } from "vitest";
import { createCasperFacilitatorClient } from "../src/facilitator-client.js";
import { createCasperSchemes } from "../src/schemes.js";
import { DEFAULT_FACILITATOR_TIMEOUT_MS, DEFAULT_FACILITATOR_URL } from "../src/constants.js";
import { CASPER_ERRORS } from "../src/errors.js";
import type { FetchLike } from "../src/types.js";

const okFetch =
  (body: unknown): FetchLike =>
  async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

describe("createCasperFacilitatorClient", () => {
  it("defaults to the hosted CSPR.cloud facilitator", () => {
    const client = createCasperFacilitatorClient({ env: {}, fetch: okFetch({}) });
    expect(client.url).toBe(DEFAULT_FACILITATOR_URL);
    expect(client.timeoutMs).toBe(DEFAULT_FACILITATOR_TIMEOUT_MS);
  });

  it("honours CASPER_FACILITATOR_URL", () => {
    const client = createCasperFacilitatorClient({
      env: { CASPER_FACILITATOR_URL: "https://self-hosted.example.com/x402/" },
      fetch: okFetch({}),
    });
    expect(client.url).toBe("https://self-hosted.example.com/x402");
  });

  it("honours CASPER_FACILITATOR_TIMEOUT_MS", () => {
    const client = createCasperFacilitatorClient({
      env: { CASPER_FACILITATOR_TIMEOUT_MS: "1500" },
      fetch: okFetch({}),
    });
    expect(client.timeoutMs).toBe(1500);
  });

  it("prefers explicit config over env", () => {
    const client = createCasperFacilitatorClient({
      facilitatorUrl: "https://explicit.example.com",
      timeoutMs: 250,
      env: { CASPER_FACILITATOR_URL: "https://env.example.com", CASPER_FACILITATOR_TIMEOUT_MS: "9" },
      fetch: okFetch({}),
    });
    expect(client.url).toBe("https://explicit.example.com");
    expect(client.timeoutMs).toBe(250);
  });

  it("rejects a non-URL, a non-http scheme and inline credentials", () => {
    expect(() => createCasperFacilitatorClient({ facilitatorUrl: "not a url", env: {} })).toThrow();
    expect(() =>
      createCasperFacilitatorClient({ facilitatorUrl: "ftp://example.com", env: {} }),
    ).toThrow("must use http(s)://");
    expect(() =>
      createCasperFacilitatorClient({ facilitatorUrl: "https://user:pw@example.com", env: {} }),
    ).toThrow("inline credentials");
  });

  it("rejects plain http:// for remote hosts but allows localhost dev", () => {
    expect(() =>
      createCasperFacilitatorClient({ facilitatorUrl: "http://example.com", env: {} }),
    ).toThrow("only permitted for localhost");
    expect(
      createCasperFacilitatorClient({ facilitatorUrl: "http://localhost:8080", env: {} }).url,
    ).toBe("http://localhost:8080");
  });

  it("rejects a non-integer timeout", () => {
    expect(() =>
      createCasperFacilitatorClient({ env: { CASPER_FACILITATOR_TIMEOUT_MS: "abc" } }),
    ).toThrow("positive integer");
    expect(() =>
      createCasperFacilitatorClient({ env: { CASPER_FACILITATOR_TIMEOUT_MS: "0" } }),
    ).toThrow("positive integer");
  });

  it("classifies an aborted request as a timeout, not a generic failure", async () => {
    const client = createCasperFacilitatorClient({
      env: {},
      timeoutMs: 5,
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    const res = await client.post("/verify", {});
    expect(res).toMatchObject({ ok: false, reason: CASPER_ERRORS.FACILITATOR_TIMEOUT });
  });

  it("sends JSON content-type headers", async () => {
    let seen: Record<string, string> | undefined;
    const client = createCasperFacilitatorClient({
      env: {},
      fetch: async (_url, init) => {
        seen = init?.headers;
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      },
    });
    await client.post("/verify", { a: 1 });
    expect(seen?.["content-type"]).toBe("application/json");
    expect(seen?.accept).toBe("application/json");
  });
});

describe("supported()", () => {
  it("returns the advertised kinds", async () => {
    const client = createCasperFacilitatorClient({
      env: {},
      fetch: okFetch({
        kinds: [
          { scheme: "exact", network: "casper:casper" },
          { scheme: "exact", network: "casper:casper-test" },
        ],
      }),
    });
    const res = await client.supported();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.body.kinds).toHaveLength(2);
      expect(res.body.kinds[0]).toEqual({ scheme: "exact", network: "casper:casper" });
    }
  });

  it("fails closed when kinds is missing", async () => {
    const client = createCasperFacilitatorClient({ env: {}, fetch: okFetch({}) });
    const res = await client.supported();
    expect(res).toMatchObject({
      ok: false,
      reason: CASPER_ERRORS.FACILITATOR_MALFORMED_RESPONSE,
    });
  });

  it("uses GET /supported", async () => {
    let method: string | undefined;
    let url: string | undefined;
    const client = createCasperFacilitatorClient({
      env: {},
      fetch: async (u, init) => {
        url = u;
        method = init?.method;
        return { ok: true, status: 200, json: async () => ({ kinds: [] }), text: async () => "" };
      },
    });
    await client.supported();
    expect(method).toBe("GET");
    expect(url).toBe(`${DEFAULT_FACILITATOR_URL}/supported`);
  });
});

describe("createCasperSchemes", () => {
  it("exposes only the exact scheme", () => {
    const schemes = createCasperSchemes({ env: {}, fetch: okFetch({}) });
    expect(Object.keys(schemes)).toEqual(["exact"]);
  });

  it("wires verify and settle through the injected client", async () => {
    const seen: string[] = [];
    const schemes = createCasperSchemes({
      env: { CASPER_TESTNET_WCSPR_CONTRACT: "hash-wcspr" },
      fetch: async (url) => {
        seen.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ isValid: true, success: true, transaction: "deploy-1" }),
          text: async () => "",
        };
      },
    });
    const requirements = {
      scheme: "exact" as const,
      network: "casper:casper-test" as const,
      asset: "hash-wcspr",
      maxAmount: "1000000000",
      payTo: "account-hash-aa",
      maxTimeoutSeconds: 60,
    };
    const payload = {
      signature: "01ab",
      authorization: {
        from: "01cd",
        to: "account-hash-aa",
        value: "1000000000",
        asset: "hash-wcspr",
        network: "casper:casper-test",
        nonce: "n1",
        deadline: "1900000000",
        validAfter: "1800000000",
      },
    };

    const verified = await schemes.exact.verify(payload, requirements);
    expect(verified).toEqual({ isValid: true, payer: "01cd" });

    const settled = await schemes.exact.settle(payload, requirements);
    expect(settled).toMatchObject({ success: true, transaction: "deploy-1" });

    expect(seen).toEqual([
      `${DEFAULT_FACILITATOR_URL}/verify`,
      `${DEFAULT_FACILITATOR_URL}/settle`,
    ]);
  });
});
