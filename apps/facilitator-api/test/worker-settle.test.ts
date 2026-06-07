import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { SettleResponse } from "@x402cloud/protocol";
import type { RetryJob } from "../src/settlement-store.js";

// `crypto.subtle.timingSafeEqual` is a Cloudflare Workers extension that does
// not exist in Node's WebCrypto. The production auth middleware uses it; under
// Node we shim it for tests only. The shim mirrors the Workers contract:
// throws on differing lengths, byte-compares otherwise. (Production code is
// unchanged — this lives only in the test runtime.)
beforeAll(() => {
  const subtle = globalThis.crypto.subtle as unknown as {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual !== "function") {
    subtle.timingSafeEqual = (a, b) => {
      const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (av.byteLength !== bv.byteLength) throw new Error("length mismatch");
      let diff = 0;
      for (let i = 0; i < av.byteLength; i++) diff |= av[i] ^ bv[i];
      return diff === 0;
    };
  }
});

// ── Controllable mock facilitator (swap settle behaviour per test) ───────────
const settleMock = vi.fn<() => Promise<SettleResponse>>();
const settleExactMock = vi.fn<() => Promise<SettleResponse>>();
const confirmMock = vi.fn<() => Promise<SettleResponse>>();

vi.mock("@x402cloud/facilitator", async (importOriginal) => {
  // Keep the real createFacilitatorRoutes + classifiers; stub createFacilitator.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createFacilitator: vi.fn(() => ({
      address: "0xFacilitator",
      network: "eip155:84532",
      schemes: {},
      verify: vi.fn(async () => ({ isValid: true, payer: "0xPayer" })),
      verifyExact: vi.fn(async () => ({ isValid: true, payer: "0xPayer" })),
      settle: (...args: unknown[]) => settleMock(...(args as [])),
      settleExact: (...args: unknown[]) => settleExactMock(...(args as [])),
      confirm: (...args: unknown[]) => confirmMock(...(args as [])),
    })),
  };
});

// CHAINS lookup must succeed for getFacilitator(). baseSepolia is fine.
vi.mock("@x402cloud/evm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { baseSepolia } = await import("viem/chains");
  return { ...actual, CHAINS: { "eip155:84532": baseSepolia } };
});

import worker from "../src/index.js";

// ── Fake bindings ────────────────────────────────────────────────────────────
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: vi.fn(async (k: string) => void store.delete(k)),
  };
}

function makeEnv() {
  const kv = fakeKv();
  const queued: RetryJob[] = [];
  const env = {
    FACILITATOR_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    FACILITATOR_API_TOKEN: "test-token",
    RPC_URL: "https://sepolia.base.org",
    NETWORK: "eip155:84532",
    OUR_ADDRESS: "0xOur",
    SETTLEMENTS_KV: kv,
    SETTLE_QUEUE: { send: vi.fn(async (j: RetryJob) => void queued.push(j)) },
  };
  return { env, kv, queued };
}

const NONCE = "999001";
const success: SettleResponse = {
  success: true,
  transaction: "0xtx",
  network: "eip155:84532",
  settledAmount: "5000",
};

function settleBody() {
  return {
    payload: {
      signature: "0xsig",
      permit2Authorization: { nonce: NONCE, permitted: { amount: "10000" } },
    },
    requirements: { scheme: "upto", network: "eip155:84532" },
    settlementAmount: "5000",
  };
}

function postSettle(env: ReturnType<typeof makeEnv>["env"], body: unknown, path = "/settle") {
  return worker.fetch(
    new Request(`https://facilitator.x402cloud.ai${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

beforeEach(() => {
  settleMock.mockReset();
  settleExactMock.mockReset();
  confirmMock.mockReset();
});

describe("worker /settle (durable)", () => {
  it("settles once and returns the result", async () => {
    settleMock.mockResolvedValue(success);
    const { env, queued } = makeEnv();

    const res = await postSettle(env, settleBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, settledAmount: "5000" });
    expect(settleMock).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(0);
  });

  it("replays the same nonce WITHOUT a second on-chain settle", async () => {
    settleMock.mockResolvedValue(success);
    const { env } = makeEnv();

    await postSettle(env, settleBody());
    await postSettle(env, settleBody()); // same nonce, same KV

    expect(settleMock).toHaveBeenCalledTimes(1); // <-- no second on-chain call
  });

  it("enqueues a retry on a transient failure and returns 202 pending", async () => {
    settleMock.mockResolvedValue({ success: false, errorReason: "settlement_failed: RPC 503" });
    const { env, queued } = makeEnv();

    const res = await postSettle(env, settleBody());

    expect(res.status).toBe(202);
    const body = (await res.json()) as { pending?: boolean; retryQueued?: boolean };
    expect(body.pending).toBe(true);
    expect(body.retryQueued).toBe(true);
    expect(queued).toEqual([
      expect.objectContaining({ scheme: "upto", nonce: NONCE, settlementAmount: "5000" }),
    ]);
  });

  it("does NOT enqueue on a definitive failure and returns 200", async () => {
    settleMock.mockResolvedValue({ success: false, errorReason: "tampered_payload" });
    const { env, queued } = makeEnv();

    const res = await postSettle(env, settleBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, errorReason: "tampered_payload" });
    expect(queued).toHaveLength(0);
  });

  it("400s when the nonce is missing", async () => {
    const { env } = makeEnv();
    const body = settleBody();
    // strip the nonce
    (body.payload.permit2Authorization as { nonce?: string }).nonce = undefined;

    const res = await postSettle(env, body);
    expect(res.status).toBe(400);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("401s without a valid bearer token", async () => {
    settleMock.mockResolvedValue(success);
    const { env } = makeEnv();

    const res = await worker.fetch(
      new Request("https://facilitator.x402cloud.ai/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settleBody()),
      }),
      env,
    );

    expect(res.status).toBe(401);
    expect(settleMock).not.toHaveBeenCalled();
  });
});

describe("worker /verify still falls through to shared routes", () => {
  it("verifies via the shared facilitator route", async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request("https://facilitator.x402cloud.ai/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify(settleBody()),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isValid: true });
  });
});

describe("worker queue() consumer", () => {
  function batchFor(job: RetryJob) {
    const ack = vi.fn();
    const retry = vi.fn();
    return { batch: { messages: [{ body: job, ack, retry }] }, ack, retry };
  }

  const uptoJob: RetryJob = {
    scheme: "upto",
    nonce: NONCE,
    mode: "broadcast",
    payload: { signature: "0xsig", permit2Authorization: { nonce: NONCE } },
    requirements: { scheme: "upto", network: "eip155:84532" },
    settlementAmount: "5000",
    network: "eip155:84532",
  };

  it("acks when the retry succeeds", async () => {
    settleMock.mockResolvedValue(success);
    const { env } = makeEnv();
    const { batch, ack, retry } = batchFor(uptoJob);

    await worker.queue(batch, env);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(settleMock).toHaveBeenCalledTimes(1);
  });

  it("retries (msg.retry) while the failure stays transient", async () => {
    settleMock.mockResolvedValue({ success: false, errorReason: "settlement_failed: still down" });
    const { env } = makeEnv();
    const { batch, ack, retry } = batchFor(uptoJob);

    await worker.queue(batch, env);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
  });

  it("eventually dead-letters: keeps calling msg.retry across attempts, never acks", async () => {
    settleMock.mockResolvedValue({ success: false, errorReason: "settlement_failed: persistent" });
    const { env } = makeEnv();

    let acks = 0;
    let retries = 0;
    for (let i = 0; i < 5; i++) {
      const { batch, ack, retry } = batchFor(uptoJob);
      await worker.queue(batch, env);
      acks += ack.mock.calls.length;
      retries += retry.mock.calls.length;
    }
    // The Queue would route to the DLQ after max_retries; our consumer only
    // ever signals retry, never ack.
    expect(acks).toBe(0);
    expect(retries).toBe(5);
  });

  it("acks without re-settling once a prior attempt recorded success (idempotent consumer)", async () => {
    const { env, kv } = makeEnv();
    // Seed a settled record under the (scheme, nonce) key.
    kv.store.set(`settle:upto:nonce:${NONCE}`, JSON.stringify({ status: "settled", result: success, settledAt: 1 }));

    const { batch, ack, retry } = batchFor(uptoJob);
    await worker.queue(batch, env);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("routes exact jobs to settleExact", async () => {
    settleExactMock.mockResolvedValue(success);
    const { env } = makeEnv();
    const exactJob: RetryJob = {
      ...uptoJob,
      scheme: "exact",
      settlementAmount: undefined,
      payload: { signature: "0xsig", permit2Authorization: { nonce: NONCE, permitted: { amount: "10000" } } },
    };
    const { batch, ack } = batchFor(exactJob);

    await worker.queue(batch, env);

    expect(settleExactMock).toHaveBeenCalledTimes(1);
    expect(settleMock).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("a CONFIRM job confirms the txHash and NEVER re-broadcasts (acks on success)", async () => {
    confirmMock.mockResolvedValue(success);
    const { env } = makeEnv();
    const confirmJob: RetryJob = { ...uptoJob, mode: "confirm", txHash: "0xfeedbeef" };
    const { batch, ack, retry } = batchFor(confirmJob);

    await worker.queue(batch, env);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(settleMock).not.toHaveBeenCalled(); // I1: never re-broadcast
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("a CONFIRM job whose receipt is still pending retries (msg.retry), never re-broadcasts", async () => {
    confirmMock.mockResolvedValue({ success: false, errorReason: "settlement_pending_receipt: 0xfeedbeef" });
    const { env } = makeEnv();
    const confirmJob: RetryJob = { ...uptoJob, mode: "confirm", txHash: "0xfeedbeef" };
    const { batch, ack, retry } = batchFor(confirmJob);

    await worker.queue(batch, env);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });
});
