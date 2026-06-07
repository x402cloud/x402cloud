import { describe, it, expect, vi } from "vitest";
import type { SettleResponse } from "@x402cloud/protocol";
import { SETTLEMENT_RECEIPT_TIMEOUT_MS } from "@x402cloud/evm";
import {
  kvSettlementStore,
  retrySettle,
  settleWithIdempotency,
  LOCK_TTL_MS,
  type ConfirmFn,
  type KvLike,
  type RetryJob,
  type RetryQueue,
  type SettlementStore,
} from "../src/settlement-store.js";

// ── Fakes ──────────────────────────────────────────────────────────────────

/** In-memory KV that satisfies KvLike. */
function fakeKv(): KvLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function fakeQueue(): RetryQueue & { sent: RetryJob[] } {
  const sent: RetryJob[] = [];
  return {
    sent,
    async send(job) {
      sent.push(job);
    },
  };
}

const NONCE = "424242";
const TX_HASH = "0xfeedbeef";

function uptoJob(): RetryJob {
  return {
    scheme: "upto",
    nonce: NONCE,
    mode: "broadcast",
    payload: { permit2Authorization: { nonce: NONCE } },
    requirements: { scheme: "upto", network: "eip155:84532" },
    settlementAmount: "5000",
    network: "eip155:84532",
  };
}

function exactJob(): RetryJob {
  return {
    scheme: "exact",
    nonce: NONCE,
    mode: "broadcast",
    payload: { permit2Authorization: { nonce: NONCE, permitted: { amount: "10000" } } },
    requirements: { scheme: "exact", network: "eip155:84532" },
    network: "eip155:84532",
  };
}

const success: SettleResponse = {
  success: true,
  transaction: "0xtx",
  network: "eip155:84532",
  settledAmount: "5000",
};

function fail(errorReason: string): SettleResponse {
  return { success: false, errorReason };
}

const pendingReceipt = fail(`settlement_pending_receipt: ${TX_HASH}`);

/** A confirm that always returns the given response, ignoring the txHash. */
function confirmReturning(r: SettleResponse): ConfirmFn {
  return vi.fn(async () => r);
}

/** A clock that returns a fixed value, mutable across a test. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

// ── Lease invariant (Finding 2) ──────────────────────────────────────────────

describe("LOCK_TTL_MS lease invariant", () => {
  it("strictly exceeds the bounded receipt timeout (lease > max settle wall-clock)", () => {
    // If the lease were <= the receipt wait, a settle still legitimately
    // mid-broadcast would have its lease expire and a concurrent attempt could
    // reclaim and double-broadcast. The lease must leave headroom above
    // sign + send + receipt-wait. The receipt wait is the dominant term.
    expect(LOCK_TTL_MS).toBeGreaterThan(SETTLEMENT_RECEIPT_TIMEOUT_MS);
    // Headroom for sign + send + margin on top of the receipt wait.
    expect(LOCK_TTL_MS).toBeGreaterThanOrEqual(SETTLEMENT_RECEIPT_TIMEOUT_MS + 30_000);
  });
});

// ── settleWithIdempotency (client path) ──────────────────────────────────────

describe("settleWithIdempotency", () => {
  it("settles once and records the result", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => success);

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "settled", result: success });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(queue.sent).toHaveLength(0);
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("(e) replays a prior settled result WITHOUT a second on-chain call (idempotent)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => success);

    await settleWithIdempotency({ store, queue, settle, job: uptoJob() });
    expect(settle).toHaveBeenCalledTimes(1);

    const settle2 = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle: settle2, job: uptoJob() });

    expect(outcome).toEqual({ kind: "replayed", result: success });
    expect(settle2).not.toHaveBeenCalled();
    expect(queue.sent).toHaveLength(0);
  });

  // ── BUG 3: idempotency keyed on (scheme, nonce), not nonce alone ──
  it("(a) does NOT dedupe the SAME nonce across DIFFERENT schemes (independent proxy bitmaps)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();

    // upto settles for this nonce.
    const uptoSettle = vi.fn(async () => success);
    await settleWithIdempotency({ store, queue, settle: uptoSettle, job: uptoJob() });

    // exact with the SAME nonce must NOT be short-circuited — it is a distinct
    // authorization on a different proxy contract.
    const exactSettle = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle: exactSettle, job: exactJob() });

    expect(outcome.kind).toBe("settled");
    expect(exactSettle).toHaveBeenCalledTimes(1); // <-- NOT deduped
    // Both records coexist under distinct keys.
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled" });
    expect(await store.get("exact", NONCE)).toMatchObject({ status: "settled" });
  });

  // ── BUG 2: in_flight is a lease ──
  it("(b) returns in_flight WITHOUT broadcasting when a non-expired lease exists", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();
    // Lease started 'now'.
    await store.put("upto", NONCE, { status: "in_flight", startedAt: c.now() });

    const settle = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob(), now: c.now });

    expect(outcome).toEqual({ kind: "in_flight" });
    expect(settle).not.toHaveBeenCalled();
    expect(queue.sent).toHaveLength(0);
  });

  it("(b) reclaims an EXPIRED in_flight lease and settles (stale lock no longer blocks forever)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();
    // Lease started long ago.
    await store.put("upto", NONCE, { status: "in_flight", startedAt: c.now() });
    c.advance(LOCK_TTL_MS + 1); // lease expired

    const settle = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob(), now: c.now });

    expect(outcome).toEqual({ kind: "settled", result: success });
    expect(settle).toHaveBeenCalledTimes(1); // reclaimed and broadcast
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled" });
  });

  // ── BUG 1 / I1: receipt-wait failure → awaiting_receipt + confirm job, no re-broadcast ──
  it("(c) records awaiting_receipt and enqueues a CONFIRM job on settlement_pending_receipt (NO re-broadcast)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => pendingReceipt);

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "awaiting_confirmation", result: pendingReceipt });
    expect(settle).toHaveBeenCalledTimes(1);
    // recorded as awaiting_receipt with the broadcast txHash
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "awaiting_receipt", txHash: TX_HASH });
    // enqueued a CONFIRM job (NOT a broadcast job)
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]).toMatchObject({ mode: "confirm", txHash: TX_HASH, scheme: "upto", nonce: NONCE });
  });

  it("(c) returns awaiting_confirmation WITHOUT broadcasting when a record is already awaiting_receipt (I1)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    await store.put("upto", NONCE, { status: "awaiting_receipt", txHash: TX_HASH, startedAt: 1 });

    const settle = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome.kind).toBe("awaiting_confirmation");
    if (outcome.kind === "awaiting_confirmation") {
      expect(outcome.result).toMatchObject({ success: false, errorReason: `settlement_pending_receipt: ${TX_HASH}` });
    }
    expect(settle).not.toHaveBeenCalled(); // never re-broadcast
    expect(queue.sent).toHaveLength(0); // a confirm job already exists from before
  });

  it("awaiting_receipt does NOT lease-expire into a re-broadcast (always confirm)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();
    await store.put("upto", NONCE, { status: "awaiting_receipt", txHash: TX_HASH, startedAt: c.now() });
    c.advance(LOCK_TTL_MS * 10); // way past any lease window

    const settle = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob(), now: c.now });

    expect(outcome.kind).toBe("awaiting_confirmation");
    expect(settle).not.toHaveBeenCalled();
  });

  // ── BUG 4: transient broadcast failure keeps the lease, does NOT delete ──
  it("(d) KEEPS the in_flight lease (does NOT delete) and enqueues a BROADCAST job on a transient failure", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const transient = fail("settlement_failed: HTTP 503");
    const settle = vi.fn(async () => transient);

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "enqueued", result: transient });
    expect(settle).toHaveBeenCalledTimes(1);
    // marker KEPT (a concurrent client must see in_flight, not a missing record)
    const rec = await store.get("upto", NONCE);
    expect(rec).toMatchObject({ status: "in_flight" });
    // enqueued a broadcast job for the queue to retry
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]).toMatchObject({ mode: "broadcast", scheme: "upto", nonce: NONCE });
  });

  it("(d) a concurrent client sees in_flight after a transient failure and does NOT broadcast", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();

    // First client hits a transient failure — lease kept, broadcast job enqueued.
    await settleWithIdempotency({
      store,
      queue,
      settle: vi.fn(async () => fail("settlement_failed: 503")),
      job: uptoJob(),
      now: c.now,
    });

    // Concurrent client (same instant) must see in_flight and NOT broadcast.
    const settle2 = vi.fn(async () => success);
    const outcome = await settleWithIdempotency({ store, queue, settle: settle2, job: uptoJob(), now: c.now });

    expect(outcome).toEqual({ kind: "in_flight" });
    expect(settle2).not.toHaveBeenCalled();
  });

  it("does NOT enqueue on a DEFINITIVE failure and records it", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const definitive = fail("transaction_reverted: 0xdead");
    const settle = vi.fn(async () => definitive);

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "settled", result: definitive });
    expect(queue.sent).toHaveLength(0);
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: definitive });
  });
});

// ── retrySettle (consumer) ───────────────────────────────────────────────────

describe("retrySettle", () => {
  it("acks and records on a successful broadcast retry", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => success);

    const res = await retrySettle({ store, queue, settle, confirm: confirmReturning(success), job: uptoJob() });

    expect(res).toEqual({ acked: true, result: success });
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled" });
  });

  it("acks without re-settling when the nonce is already settled", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    await store.put("upto", NONCE, { status: "settled", result: success, settledAt: 1 });
    const settle = vi.fn(async () => success);
    const confirm = confirmReturning(success);

    const res = await retrySettle({ store, queue, settle, confirm, job: uptoJob() });

    expect(res).toEqual({ acked: true, result: success });
    expect(settle).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("throws on a still-transient broadcast failure so the Queue retries / dead-letters; refreshes the lease", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => fail("settlement_failed: still down"));
    const c = clock();

    await expect(
      retrySettle({ store, queue, settle, confirm: confirmReturning(success), job: uptoJob(), now: c.now }),
    ).rejects.toThrow(/transient/);
    // lease refreshed (kept), not deleted — a concurrent client still sees in_flight
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "in_flight", startedAt: c.now() });
    // consumer does NOT re-enqueue (the Queue owns the retry of THIS message)
    expect(queue.sent).toHaveLength(0);
  });

  it("acks (does NOT throw) on a definitive failure — no point retrying", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const definitive = fail("tampered_payload");
    const settle = vi.fn(async () => definitive);

    const res = await retrySettle({ store, queue, settle, confirm: confirmReturning(success), job: uptoJob() });

    expect(res).toEqual({ acked: true, result: definitive });
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: definitive });
  });

  // ── BUG 1 / I1+I2: confirm path ──
  it("(c) CONFIRM job with success → records settled-success (I2: a real success is never recorded as failed)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const confirm = confirmReturning(success);
    const settle = vi.fn(async () => fail("should not be called"));
    const job: RetryJob = { ...uptoJob(), mode: "confirm", txHash: TX_HASH };

    const res = await retrySettle({ store, queue, settle, confirm, job });

    expect(res).toEqual({ acked: true, result: success });
    expect(confirm).toHaveBeenCalledWith(TX_HASH);
    expect(settle).not.toHaveBeenCalled(); // NEVER re-broadcast (I1)
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("(c) CONFIRM job with transaction_reverted → records settled-failure (a genuine on-chain revert)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const reverted = fail(`transaction_reverted: ${TX_HASH}`);
    const confirm = confirmReturning(reverted);
    const settle = vi.fn(async () => success);
    const job: RetryJob = { ...uptoJob(), mode: "confirm", txHash: TX_HASH };

    const res = await retrySettle({ store, queue, settle, confirm, job });

    expect(res).toEqual({ acked: true, result: reverted });
    expect(settle).not.toHaveBeenCalled();
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: reverted });
  });

  it("(c) CONFIRM job still pending → throws so the Queue retries the confirm (never re-broadcasts)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const confirm = confirmReturning(pendingReceipt);
    const settle = vi.fn(async () => success);
    const job: RetryJob = { ...uptoJob(), mode: "confirm", txHash: TX_HASH };

    await expect(retrySettle({ store, queue, settle, confirm, job })).rejects.toThrow(/pending receipt/);
    expect(settle).not.toHaveBeenCalled();
  });

  it("uses the txHash from an existing awaiting_receipt record even on a broadcast-mode job (I1)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    await store.put("upto", NONCE, { status: "awaiting_receipt", txHash: TX_HASH, startedAt: 1 });
    const confirm = vi.fn(async () => success);
    const settle = vi.fn(async () => success);
    // job arrives as broadcast, but the record says a tx already exists.
    const res = await retrySettle({ store, queue, settle, confirm, job: uptoJob() });

    expect(res).toEqual({ acked: true, result: success });
    expect(confirm).toHaveBeenCalledWith(TX_HASH);
    expect(settle).not.toHaveBeenCalled();
  });

  it("a broadcast retry that hits pending_receipt records awaiting_receipt, enqueues a confirm job, and ACKS", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => pendingReceipt);
    const confirm = confirmReturning(success);

    const res = await retrySettle({ store, queue, settle, confirm, job: uptoJob() });

    expect(res.acked).toBe(true);
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "awaiting_receipt", txHash: TX_HASH });
    expect(queue.sent).toEqual([expect.objectContaining({ mode: "confirm", txHash: TX_HASH })]);
  });
});

// ── Finding 3: settled-success is a sticky one-way latch (I2) ─────────────────

describe("sticky settled-success latch (Finding 3 / I2)", () => {
  const reverted = fail(`transaction_reverted: ${TX_HASH}`);

  it("settleWithIdempotency: a definitive failure landing AFTER a concurrent success keeps the success", async () => {
    // Models the race: no prior record, so this attempt claims its own lease and
    // calls settle(), which resolves to a definitive REVERT. But DURING that
    // settle() a concurrent winner records settled-success. The recorder must
    // re-read before writing the failure and preserve the success.
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();

    const settle = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: c.now() });
      return reverted;
    });

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob(), now: c.now });

    // The failure must NOT overwrite the concurrent success.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("settled");
    if (outcome.kind === "settled") expect(outcome.result).toEqual(success);
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("retrySettle (broadcast): a definitive failure after a concurrent success keeps the success", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();

    const settle = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: c.now() });
      return fail("tampered_payload");
    });

    const res = await retrySettle({
      store,
      queue,
      settle,
      confirm: confirmReturning(success),
      job: uptoJob(),
      now: c.now,
    });

    expect(res.result).toEqual(success); // returns the preserved success
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("retrySettle (confirm): a transaction_reverted after a concurrent success keeps the success", async () => {
    // The single-use nonce means at most one tx succeeded. A duplicate confirm of
    // the LOSER (reverted) must never overwrite the winner's recorded success.
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const c = clock();

    const confirm = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: c.now() });
      return reverted;
    });
    const settle = vi.fn(async () => success);
    const job: RetryJob = { ...uptoJob(), mode: "confirm", txHash: TX_HASH };

    const res = await retrySettle({ store, queue, settle, confirm, job, now: c.now });

    expect(res.result).toEqual(success);
    expect(settle).not.toHaveBeenCalled(); // I1: never re-broadcast
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("a settled-SUCCESS may always be written (success latches normally)", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => success);

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "settled", result: success });
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });
});

// ── kvSettlementStore adapter ─────────────────────────────────────────────────

describe("kvSettlementStore", () => {
  it("namespaces keys by (scheme, nonce) and round-trips JSON", async () => {
    const kv = fakeKv();
    const store = kvSettlementStore(kv);
    const record = { status: "settled" as const, result: success, settledAt: 7 };

    await store.put("upto", NONCE, record);

    expect([...kv.store.keys()]).toEqual([`settle:upto:nonce:${NONCE}`]);
    expect(await store.get("upto", NONCE)).toEqual(record);
  });

  it("upto and exact records for the same nonce live under DISTINCT keys (BUG 3)", async () => {
    const kv = fakeKv();
    const store = kvSettlementStore(kv);

    await store.put("upto", NONCE, { status: "in_flight", startedAt: 1 });
    await store.put("exact", NONCE, { status: "in_flight", startedAt: 2 });

    expect([...kv.store.keys()].sort()).toEqual(
      [`settle:exact:nonce:${NONCE}`, `settle:upto:nonce:${NONCE}`].sort(),
    );
    expect(await store.get("upto", NONCE)).toMatchObject({ startedAt: 1 });
    expect(await store.get("exact", NONCE)).toMatchObject({ startedAt: 2 });
  });

  it("returns null for an unknown (scheme, nonce)", async () => {
    const store: SettlementStore = kvSettlementStore(fakeKv());
    expect(await store.get("upto", "does-not-exist")).toBeNull();
  });

  it("delete removes the record", async () => {
    const store = kvSettlementStore(fakeKv());
    await store.put("upto", NONCE, { status: "in_flight", startedAt: 1 });
    await store.delete("upto", NONCE);
    expect(await store.get("upto", NONCE)).toBeNull();
  });

  it("sets an expiration TTL on put", async () => {
    const put = vi.fn(async () => {});
    const kv: KvLike = { get: async () => null, put, delete: async () => {} };
    const store = kvSettlementStore(kv);

    await store.put("upto", NONCE, { status: "in_flight", startedAt: 1 });

    expect(put).toHaveBeenCalledWith(
      `settle:upto:nonce:${NONCE}`,
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });
});

// ── Intermediate-write success guard (Finding 3b / I2) ───────────────────────
//
// putSettledSticky guards TERMINAL failure writes; these cover the INTERMEDIATE
// writes (in_flight claim, awaiting_receipt). A racing winner can latch
// settled-success between our initial read and an intermediate write — that write
// must NOT demote the success, or a same-nonce re-broadcast would revert and be
// recorded as a failure = lost revenue. (KV has no CAS; these prove the guard
// narrows the window. The on-chain single-use nonce is the ultimate backstop.)
describe("intermediate-write success guard (Finding 3b / I2)", () => {
  it("settleWithIdempotency: success latched during settle() (pending_receipt) is kept; no confirm enqueued", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    // settle() simulates a concurrent winner latching success, then returns pending.
    const settle = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: 1 });
      return pendingReceipt;
    });

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "settled", result: success });
    expect(queue.sent).toHaveLength(0); // no confirm job enqueued over a latched success
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("settleWithIdempotency: success latched during settle() (transient) is kept; no broadcast enqueued", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: 1 });
      return fail("settlement_failed: HTTP 503");
    });

    const outcome = await settleWithIdempotency({ store, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "settled", result: success });
    expect(queue.sent).toHaveLength(0);
    expect(await store.get("upto", NONCE)).toMatchObject({ status: "settled", result: success });
  });

  it("settleWithIdempotency: success appearing between the top read and the claim short-circuits to replayed (no broadcast)", async () => {
    // A store whose get() returns null on the FIRST call (top read, looks empty)
    // and a settled-success thereafter (the re-read inside the claim guard).
    const base = kvSettlementStore(fakeKv());
    await base.put("upto", NONCE, { status: "settled", result: success, settledAt: 1 });
    let calls = 0;
    const raceStore: SettlementStore = {
      get: async (scheme, nonce) => {
        calls += 1;
        return calls === 1 ? null : base.get(scheme, nonce);
      },
      put: (scheme, nonce, record) => base.put(scheme, nonce, record),
      delete: (scheme, nonce) => base.delete(scheme, nonce),
    };
    const queue = fakeQueue();
    const settle = vi.fn(async () => success);

    const outcome = await settleWithIdempotency({ store: raceStore, queue, settle, job: uptoJob() });

    expect(outcome).toEqual({ kind: "replayed", result: success });
    expect(settle).not.toHaveBeenCalled(); // never broadcast over a latched success
    expect(queue.sent).toHaveLength(0);
  });

  it("retrySettle (broadcast): success latched during settle() (pending_receipt) is kept; ack, no confirm job", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: 1 });
      return pendingReceipt;
    });

    const res = await retrySettle({ store, queue, settle, confirm: confirmReturning(success), job: uptoJob() });

    expect(res).toEqual({ acked: true, result: success });
    expect(queue.sent).toHaveLength(0);
  });

  it("retrySettle (broadcast): success latched during settle() (transient) is kept; ack without throwing", async () => {
    const store = kvSettlementStore(fakeKv());
    const queue = fakeQueue();
    const settle = vi.fn(async () => {
      await store.put("upto", NONCE, { status: "settled", result: success, settledAt: 1 });
      return fail("settlement_failed: HTTP 503");
    });

    const res = await retrySettle({ store, queue, settle, confirm: confirmReturning(success), job: uptoJob() });

    expect(res).toEqual({ acked: true, result: success });
  });
});
