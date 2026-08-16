import { describe, it, expect } from "vitest";
import type { PaymentRequirements } from "@x402cloud/protocol";
import { verifyExact } from "../src/exact/verify.js";
import { createCasperFacilitatorClient } from "../src/facilitator-client.js";
import type { FetchLike } from "../src/types.js";
import { CASPER_ERRORS } from "../src/errors.js";

const ENV = { CASPER_TESTNET_WCSPR_CONTRACT: "hash-wcspr" };

const requirements = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: "casper:casper-test",
  asset: "hash-wcspr",
  maxAmount: "2500000000",
  payTo: "account-hash-" + "ef".repeat(32),
  maxTimeoutSeconds: 60,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  signature: "01" + "ab".repeat(32),
  authorization: {
    from: "01" + "cd".repeat(32),
    to: "account-hash-" + "ef".repeat(32),
    value: "2500000000",
    asset: "hash-wcspr",
    network: "casper:casper-test",
    nonce: "nonce-1",
    deadline: "1900000000",
    validAfter: "1800000000",
    ...over,
  },
});

/** Build a client backed by a stub fetch that records the outbound request. */
function stubClient(
  handler: (url: string, init?: Parameters<FetchLike>[1]) => unknown,
  status = 200,
) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const result = handler(url, init);
    if (result instanceof Error) throw result;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result,
      text: async () => JSON.stringify(result),
    };
  };
  return {
    calls,
    client: createCasperFacilitatorClient({
      facilitatorUrl: "https://x402-facilitator.cspr.cloud",
      fetch: fetchStub,
      env: {},
    }),
  };
}

describe("verifyExact", () => {
  it("returns valid when the facilitator approves", async () => {
    const { client, calls } = stubClient(() => ({ isValid: true, payer: "01" + "cd".repeat(32) }));
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ isValid: true, payer: "01" + "cd".repeat(32) });
    expect(calls[0].url).toBe("https://x402-facilitator.cspr.cloud/verify");
  });

  it("posts an x402 v2 body with scheme and network", async () => {
    const { client, calls } = stubClient(() => ({ isValid: true }));
    await verifyExact(client, payload(), requirements(), ENV);
    const body = calls[0].body as Record<string, any>;
    expect(body.x402Version).toBe(2);
    expect(body.paymentPayload.scheme).toBe("exact");
    expect(body.paymentPayload.network).toBe("casper:casper-test");
    expect(body.paymentRequirements.asset).toBe("hash-wcspr");
  });

  it("falls back to the authorization's payer when the facilitator omits it", async () => {
    const { client } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ isValid: true, payer: "01" + "cd".repeat(32) });
  });

  it("propagates the facilitator's invalidReason", async () => {
    const { client } = stubClient(() => ({ isValid: false, invalidReason: "insufficient_funds" }));
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: "insufficient_funds" });
  });

  it("rejects a non-Casper network without calling the facilitator", async () => {
    const { client, calls } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(
      client,
      payload(),
      requirements({ network: "eip155:8453" }),
      ENV,
    );
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.UNSUPPORTED_NETWORK });
    expect(calls).toHaveLength(0);
  });

  it("rejects an unsupported scheme without calling the facilitator", async () => {
    const { client, calls } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload(), requirements({ scheme: "upto" }), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.UNSUPPORTED_SCHEME });
    expect(calls).toHaveLength(0);
  });

  it("rejects a malformed payload without calling the facilitator", async () => {
    const { client, calls } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, { nope: true }, requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.INVALID_PAYLOAD });
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the wCSPR contract is not configured", async () => {
    const { client } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload(), requirements({ asset: "" }), {});
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.ASSET_NOT_CONFIGURED });
  });

  it("rejects a payload whose asset differs from the requirements", async () => {
    const { client } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload({ asset: "hash-other" }), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.REQUIREMENTS_MISMATCH });
  });

  it("rejects a payload paying a different recipient", async () => {
    const { client } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload({ to: "account-hash-beef" }), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.REQUIREMENTS_MISMATCH });
  });

  it("rejects an underpaying authorization — exact means exact", async () => {
    const { client } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload({ value: "2499999999" }), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.REQUIREMENTS_MISMATCH });
  });

  it("rejects a payload signed for a different Casper network", async () => {
    const { client } = stubClient(() => ({ isValid: true }));
    const res = await verifyExact(client, payload({ network: "casper:casper" }), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.REQUIREMENTS_MISMATCH });
  });

  it("fails closed on a facilitator 5xx", async () => {
    const { client } = stubClient(() => ({ error: "boom" }), 502);
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.FACILITATOR_ERROR });
  });

  it("fails closed when the facilitator is unreachable", async () => {
    const { client } = stubClient(() => new Error("ECONNREFUSED"));
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: CASPER_ERRORS.FACILITATOR_UNREACHABLE });
  });

  it("fails closed when the facilitator returns a non-object body", async () => {
    const { client } = stubClient(() => "not-json-object");
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({
      isValid: false,
      invalidReason: CASPER_ERRORS.FACILITATOR_MALFORMED_RESPONSE,
    });
  });

  it("treats a body without isValid:true as invalid, never as approved", async () => {
    const { client } = stubClient(() => ({ isValid: "true" }));
    const res = await verifyExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ isValid: false, invalidReason: "invalid_payload" });
  });
});
