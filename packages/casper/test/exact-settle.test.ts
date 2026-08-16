import { describe, it, expect } from "vitest";
import type { PaymentRequirements } from "@x402cloud/protocol";
import { settleExact } from "../src/exact/settle.js";
import { createCasperFacilitatorClient } from "../src/facilitator-client.js";
import type { FetchLike } from "../src/types.js";
import { CASPER_ERRORS } from "../src/errors.js";

const ENV = { CASPER_TESTNET_WCSPR_CONTRACT: "hash-wcspr" };
const DEPLOY_HASH = "deploy-" + "12".repeat(16);

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

function stubClient(handler: () => unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const result = handler();
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

describe("settleExact", () => {
  it("returns the deploy hash on success", async () => {
    const { client, calls } = stubClient(() => ({
      success: true,
      transaction: DEPLOY_HASH,
      network: "casper:casper-test",
      settledAmount: "2500000000",
    }));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({
      success: true,
      transaction: DEPLOY_HASH,
      network: "casper:casper-test",
      settledAmount: "2500000000",
    });
    expect(calls[0].url).toBe("https://x402-facilitator.cspr.cloud/settle");
  });

  it("accepts deployHash as an alias for transaction", async () => {
    const { client } = stubClient(() => ({ success: true, deployHash: DEPLOY_HASH }));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toMatchObject({ success: true, transaction: DEPLOY_HASH });
  });

  it("defaults settledAmount to the authorized motes", async () => {
    const { client } = stubClient(() => ({ success: true, transaction: DEPLOY_HASH }));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toMatchObject({ settledAmount: "2500000000" });
  });

  it("always reports the requirements' network, not the facilitator's echo", async () => {
    const { client } = stubClient(() => ({
      success: true,
      transaction: DEPLOY_HASH,
      network: "casper:casper",
    }));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toMatchObject({ network: "casper:casper-test" });
  });

  it("propagates the facilitator's errorReason", async () => {
    const { client } = stubClient(() => ({ success: false, errorReason: "nonce_already_used" }));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ success: false, errorReason: "nonce_already_used" });
  });

  it("fails closed on success:true with no deploy hash — an unverifiable settlement", async () => {
    const { client } = stubClient(() => ({ success: true }));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({
      success: false,
      errorReason: CASPER_ERRORS.FACILITATOR_MALFORMED_RESPONSE,
    });
  });

  it("fails closed on a facilitator 5xx", async () => {
    const { client } = stubClient(() => ({ error: "boom" }), 503);
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ success: false, errorReason: CASPER_ERRORS.FACILITATOR_ERROR });
  });

  it("fails closed when the facilitator is unreachable", async () => {
    const { client } = stubClient(() => new Error("ENOTFOUND"));
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(res).toEqual({ success: false, errorReason: CASPER_ERRORS.FACILITATOR_UNREACHABLE });
  });

  it("rejects a non-Casper network without calling the facilitator", async () => {
    const { client, calls } = stubClient(() => ({ success: true, transaction: DEPLOY_HASH }));
    const res = await settleExact(client, payload(), requirements({ network: "eip155:8453" }), ENV);
    expect(res).toEqual({ success: false, errorReason: CASPER_ERRORS.UNSUPPORTED_NETWORK });
    expect(calls).toHaveLength(0);
  });

  it("rejects a malformed payload without calling the facilitator", async () => {
    const { client, calls } = stubClient(() => ({ success: true, transaction: DEPLOY_HASH }));
    const res = await settleExact(client, { bogus: 1 }, requirements(), ENV);
    expect(res).toEqual({ success: false, errorReason: CASPER_ERRORS.INVALID_PAYLOAD });
    expect(calls).toHaveLength(0);
  });

  it("rejects an amount mismatch without calling the facilitator", async () => {
    const { client, calls } = stubClient(() => ({ success: true, transaction: DEPLOY_HASH }));
    const res = await settleExact(client, payload({ value: "1" }), requirements(), ENV);
    expect(res).toEqual({ success: false, errorReason: CASPER_ERRORS.REQUIREMENTS_MISMATCH });
    expect(calls).toHaveLength(0);
  });

  it("never leaks the facilitator URL in an error reason", async () => {
    const { client } = stubClient(
      () => new Error("connect failed https://x402-facilitator.cspr.cloud/settle?token=SECRET"),
    );
    const res = await settleExact(client, payload(), requirements(), ENV);
    expect(JSON.stringify(res)).not.toContain("SECRET");
  });
});
