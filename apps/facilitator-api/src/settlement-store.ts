import type { Network, SettleResponse } from "@x402cloud/protocol";
import { classifySettlement, pendingReceiptTxHash } from "@x402cloud/facilitator";

/**
 * Durable settlement orchestration for the hosted facilitator.
 *
 * The pure on-chain settle/confirm logic lives in @x402cloud/evm and must stay
 * pure (no storage, no queues). The pure 3-way classifier lives in
 * @x402cloud/facilitator. Durability — idempotency + retry — is an *app*
 * concern, so it lives here. We inject the store and the queue as small ports
 * (structural records of functions), which keeps this module testable with
 * plain mocks and lets the worker swap KV/Queues for anything that satisfies
 * the shape.
 *
 *   settle/confirm (pure) + classify (pure) + store + queue → durable settle
 *
 * ── Idempotency boundary ──
 * We key on (scheme, nonce). upto and exact use DIFFERENT proxy contracts with
 * INDEPENDENT Permit2 nonce bitmaps, so the same nonce value can be two distinct
 * valid authorizations. The idempotency key MUST match the on-chain uniqueness
 * boundary, hence (scheme, nonce) — not nonce alone.
 *
 * ── This is NOT a hard distributed lock ──
 * KV has no compare-and-set. Every read→write guard below (the lease check, the
 * sticky-success latch, the intermediate-write guard) NARROWS its TOCTOU window
 * but cannot fully eliminate it on KV. The single-use on-chain Permit2 nonce is
 * the ultimate double-spend backstop: even if two attempts race past the
 * app-layer checks, only ONE on-chain settle() can consume the nonce; the other
 * reverts. So a DOUBLE CHARGE is impossible regardless. The app layer's job is to
 * AVOID wasted gas, corrupted records, and lost revenue in the common case — not
 * to guarantee mutual exclusion. Every residual race here is bounded by that
 * nonce backstop.
 *
 * For a HARD guarantee (true exactly-once recorded outcomes with no TOCTOU),
 * back this store with a Durable Object instead of KV: a DO is single-threaded
 * with transactional storage, giving atomic read-modify-write so the latch and
 * lease become real invariants rather than narrowed races. Recommended before
 * high-volume mainnet. The SettlementStore port is already the seam for that
 * swap — only kvSettlementStore changes.
 *
 * ── Two invariants (violating either is a money bug) ──
 * I1. Once a txHash exists for a (scheme, nonce), NEVER settle()/re-broadcast
 *     again — only CONFIRM the known txHash. Re-broadcast reverts on the
 *     single-use nonce, wastes gas, and gets recorded as a failure even though
 *     the original tx already charged the payer = LOST REVENUE.
 * I2. A settlement that actually succeeded on-chain must NEVER be recorded or
 *     returned as failed.
 */

// ── State machine ─────────────────────────────────────────────────────────

/**
 * A recorded settlement outcome, keyed by (scheme, nonce).
 *
 *   in_flight        claimed; broadcasting in progress. LEASE-EXPIRABLE — a
 *                    crash before the terminal put leaves this behind, so a
 *                    later attempt reclaims it once the lease expires.
 *   awaiting_receipt the tx WAS broadcast but the receipt is unknown. CONFIRM
 *                    only — NEVER re-broadcast (I1). Does NOT lease-expire: it
 *                    always resolves via confirm(), never via a fresh broadcast.
 *   settled          terminal (success OR definitive failure). Replayed forever.
 */
export type SettlementRecord =
  | { status: "in_flight"; startedAt: number }
  | { status: "awaiting_receipt"; txHash: string; startedAt: number }
  | { status: "settled"; result: SettleResponse; settledAt: number };

/**
 * Idempotency store port. KV-backed in production; a Map in tests.
 * get/put/delete operate on JSON-serialisable SettlementRecord values keyed by
 * (scheme, nonce).
 */
export type SettlementStore = {
  get(scheme: Scheme, nonce: string): Promise<SettlementRecord | null>;
  put(scheme: Scheme, nonce: string, record: SettlementRecord): Promise<void>;
  delete(scheme: Scheme, nonce: string): Promise<void>;
};

export type Scheme = "upto" | "exact";

/**
 * A retry job carries everything the consumer needs to re-attempt.
 *   mode "broadcast" → re-run settle() (no tx exists yet)
 *   mode "confirm"   → confirm an already-broadcast txHash (NEVER re-broadcast)
 */
export type RetryJob = {
  scheme: Scheme;
  /** Permit2 nonce — half of the idempotency key. */
  nonce: string;
  /** What the consumer should do: broadcast a new tx or confirm an existing one. */
  mode: "broadcast" | "confirm";
  payload: Record<string, unknown>;
  requirements: Record<string, unknown>;
  /** Present for upto; absent for exact (settles full authorization). */
  settlementAmount?: string;
  /** Present for confirm jobs — the broadcast tx to look up. */
  txHash?: string;
  /** Present for confirm jobs — the network the tx lives on. */
  network?: Network;
};

/** Retry queue port. Cloudflare Queue producer in production; a spy in tests. */
export type RetryQueue = {
  send(job: RetryJob): Promise<void>;
};

/** The pure settle call we wrap — returns a SettleResponse, never throws. */
export type SettleFn = () => Promise<SettleResponse>;

/** The pure confirm call — looks up an already-broadcast tx; never throws. */
export type ConfirmFn = (txHash: string) => Promise<SettleResponse>;

// ── Lease ───────────────────────────────────────────────────────────────────

/**
 * in_flight is a LEASE, not a permanent lock. If the worker crashes between
 * claiming the nonce and writing the terminal record, the in_flight marker would
 * otherwise block settlement for the full record TTL (~30 days) and the payment
 * would NEVER be collected (BUG 2). Treating it as a time-bounded lease lets a
 * later attempt reclaim a stale claim and broadcast — the on-chain nonce is the
 * backstop against an actual double broadcast.
 *
 * INVARIANT (Finding 2): LOCK_TTL_MS > max settle wall-clock
 *   = sign + send + SETTLEMENT_RECEIPT_TIMEOUT_MS (+ margin).
 *
 * If the lease were SHORTER than the worst-case settle, an attempt still legitimately
 * mid-broadcast would have its lease expire, letting a concurrent attempt reclaim
 * and double-broadcast. The bounded receipt wait (SETTLEMENT_RECEIPT_TIMEOUT_MS,
 * 60s) replaces viem's 180s default precisely so this lease can stay above the
 * worst case. 180s here = 60s receipt timeout + generous sign/send/margin
 * headroom. The static check in the tests asserts LOCK_TTL_MS exceeds the
 * configured receipt timeout.
 */
export const LOCK_TTL_MS = 180_000;

/** True if an in_flight lease started at `startedAt` is still valid at `now`. */
function leaseValid(startedAt: number, now: number): boolean {
  return now - startedAt < LOCK_TTL_MS;
}

// ── Sticky-success latch (Finding 3) ─────────────────────────────────────────

/** True if a stored record is a terminal, on-chain SUCCESS. */
function isSettledSuccess(record: SettlementRecord | null): boolean {
  return record !== null && record.status === "settled" && record.result.success === true;
}

/**
 * Write a terminal `settled` record, treating settled-success as a STICKY
 * one-way latch (Finding 3, invariant I2).
 *
 * KV is last-write-wins. Two attempts can race (a reclaimed expired lease, or an
 * at-least-once Queue redelivery): the on-chain single-use nonce guarantees ONE
 * tx succeeds and the loser reverts, but a loser's settled-FAILURE put can land
 * AFTER the winner's settled-SUCCESS and overwrite it = recorded failed = lost
 * revenue. So before persisting a FAILURE we re-read; if the record is already a
 * settled-success we keep it and return that success. A settled-SUCCESS may
 * always be written (success can only latch, never un-latch).
 *
 * Returns the result that is now durable (the incoming one, unless a prior
 * success was preserved), so callers surface what KV actually holds.
 */
async function putSettledSticky(
  store: SettlementStore,
  scheme: Scheme,
  nonce: string,
  result: SettleResponse,
  settledAt: number,
): Promise<SettleResponse> {
  if (!result.success) {
    const existing = await store.get(scheme, nonce);
    if (isSettledSuccess(existing)) {
      // existing is settled-success — never clobber a real success with a failure.
      return (existing as { status: "settled"; result: SettleResponse }).result;
    }
  }
  await store.put(scheme, nonce, { status: "settled", result, settledAt });
  return result;
}

/**
 * Write a NON-terminal record (in_flight / awaiting_receipt) UNLESS a
 * settled-success has already latched for this (scheme, nonce) — in which case
 * we must not demote it (Finding 3b / I2). A racing winner can latch success
 * between an earlier read and this write; demoting that to in_flight would let a
 * fresh broadcast revert on the consumed nonce and then get recorded as a
 * failure = lost revenue.
 *
 * Returns the latched success (caller MUST short-circuit to it) or null after
 * writing the intermediate record.
 *
 * We gate on settled-SUCCESS only, never on settled-FAILURE: a definitive
 * failure such as `transaction_reverted` did NOT consume the single-use nonce
 * (the revert rolled state back), so a later attempt with a real pending tx may
 * still succeed and must be allowed to progress.
 *
 * KV has no compare-and-set, so this NARROWS the read→write TOCTOU window but
 * cannot fully eliminate it. The single-use on-chain Permit2 nonce remains the
 * ultimate backstop (no double charge is ever possible). For a hard guarantee,
 * back the store with a Durable Object (single-threaded, transactional storage)
 * instead of KV — see the module note.
 */
async function putUnlessSuccessLatched(
  store: SettlementStore,
  scheme: Scheme,
  nonce: string,
  record: SettlementRecord,
): Promise<SettleResponse | null> {
  const existing = await store.get(scheme, nonce);
  if (isSettledSuccess(existing)) {
    return (existing as { status: "settled"; result: SettleResponse }).result;
  }
  await store.put(scheme, nonce, record);
  return null;
}

// ── KV adapter ────────────────────────────────────────────────────────────

/** Minimal KV surface we depend on (matches Cloudflare KVNamespace). */
export type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

const KEY_PREFIX = "settle:";
/** Keep records ~30 days so replays of an old (scheme,nonce) still short-circuit. */
const RECORD_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * The idempotency key. (scheme, nonce) — see "Idempotency boundary" above.
 * e.g. settle:upto:nonce:12345
 */
function recordKey(scheme: Scheme, nonce: string): string {
  return `${KEY_PREFIX}${scheme}:nonce:${nonce}`;
}

/** Adapt a Cloudflare KV namespace to the SettlementStore port. */
export function kvSettlementStore(kv: KvLike): SettlementStore {
  return {
    async get(scheme, nonce) {
      const raw = await kv.get(recordKey(scheme, nonce));
      if (!raw) return null;
      return JSON.parse(raw) as SettlementRecord;
    },
    async put(scheme, nonce, record) {
      await kv.put(recordKey(scheme, nonce), JSON.stringify(record), {
        expirationTtl: RECORD_TTL_SECONDS,
      });
    },
    async delete(scheme, nonce) {
      await kv.delete(recordKey(scheme, nonce));
    },
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/** What the /settle handler does with the outcome of a durable settle. */
export type DurableSettleOutcome =
  | { kind: "replayed"; result: SettleResponse } // prior settled result, no on-chain call
  | { kind: "in_flight" } // another attempt holds a valid lease; do not double-submit
  | { kind: "awaiting_confirmation"; result: SettleResponse } // tx broadcast, receipt pending; a confirm job exists
  | { kind: "settled"; result: SettleResponse } // we just settled (success or definitive failure)
  | { kind: "enqueued"; result: SettleResponse }; // transient broadcast failure — queued for retry

/**
 * Settle durably, keyed on (scheme, nonce).
 *
 *  existing settled          → replay it, NO on-chain call (idempotency)
 *  existing awaiting_receipt → return awaiting_confirmation, NO broadcast (a
 *                              confirm job already exists; the tx is real) (I1)
 *  existing in_flight (valid lease)   → return in_flight, NO broadcast
 *  existing in_flight (expired lease) → reclaim and fall through (BUG 2 fix)
 *  no record / reclaiming    → put in_flight{now}, call settle():
 *     - success | definitive          → put settled; return settled
 *     - settlement_pending_receipt(h) → put awaiting_receipt{h}; enqueue a
 *                                       CONFIRM job; return awaiting_confirmation
 *     - transient (no tx)             → refresh in_flight{now} (KEEP the lease,
 *                                       BUG 4 fix); enqueue a BROADCAST job;
 *                                       return enqueued
 *
 * On a transient broadcast failure we do NOT delete the marker (the old code
 * did — BUG 4). Keeping the lease means a concurrent client sees in_flight and
 * returns pending instead of broadcasting in parallel with the queue consumer.
 * The QUEUE owns the retry.
 */
export async function settleWithIdempotency(args: {
  store: SettlementStore;
  queue: RetryQueue;
  settle: SettleFn;
  job: RetryJob;
  now?: () => number;
}): Promise<DurableSettleOutcome> {
  const { store, queue, settle, job } = args;
  const now = args.now ?? Date.now;
  const { scheme, nonce } = job;

  const existing = await store.get(scheme, nonce);
  if (existing) {
    if (existing.status === "settled") {
      return { kind: "replayed", result: existing.result };
    }
    if (existing.status === "awaiting_receipt") {
      // A tx is already broadcast — NEVER re-broadcast (I1). A confirm job is in
      // flight; tell the caller it's pending.
      return {
        kind: "awaiting_confirmation",
        result: { success: false, errorReason: `settlement_pending_receipt: ${existing.txHash}` },
      };
    }
    // in_flight: respect a valid lease; reclaim an expired one (BUG 2).
    if (leaseValid(existing.startedAt, now())) {
      return { kind: "in_flight" };
    }
    // else fall through and reclaim the stale lease.
  }

  // Claim (or reclaim) the nonce before any on-chain work — but never demote a
  // settled-success that a racing winner latched since our read above (I2).
  const latched = await putUnlessSuccessLatched(store, scheme, nonce, {
    status: "in_flight",
    startedAt: now(),
  });
  if (latched) {
    return { kind: "replayed", result: latched };
  }

  const result = await settle();
  return recordSettleResult({ store, queue, job, result, now });
}

/**
 * Map a fresh settle() result onto a stored record + outcome. Shared by the
 * client path (after a broadcast attempt) — the 3-way classifier decides.
 */
async function recordSettleResult(args: {
  store: SettlementStore;
  queue: RetryQueue;
  job: RetryJob;
  result: SettleResponse;
  now: () => number;
}): Promise<DurableSettleOutcome> {
  const { store, queue, job, result, now } = args;
  const { scheme, nonce } = job;

  switch (classifySettlement(result)) {
    case "definitive": {
      // success OR definitive failure → terminal; record and return. Writing a
      // FAILURE never clobbers a prior settled-success (Finding 3 / I2).
      const stored = await putSettledSticky(store, scheme, nonce, result, now());
      return { kind: "settled", result: stored };
    }
    case "retry_confirm": {
      // A tx WAS broadcast; only the receipt is unknown. Record awaiting_receipt
      // and hand off a CONFIRM job — NEVER a broadcast (I1). But if a racing
      // winner already latched success for this nonce, our same-nonce tx will
      // revert; keep the success (I2) and skip the pointless confirm job.
      const txHash = pendingReceiptTxHash(result) ?? "";
      const latched = await putUnlessSuccessLatched(store, scheme, nonce, {
        status: "awaiting_receipt",
        txHash,
        startedAt: now(),
      });
      if (latched) {
        return { kind: "settled", result: latched };
      }
      await queue.send({
        ...job,
        mode: "confirm",
        txHash,
        network: job.network,
      });
      return { kind: "awaiting_confirmation", result };
    }
    case "retry_broadcast": {
      // Transient broadcast failure: NO tx exists. KEEP/refresh the lease (BUG 4)
      // so a concurrent client sees in_flight and returns pending; the QUEUE owns
      // the retry as a broadcast job. But never demote a racing winner's
      // settled-success (I2).
      const latched = await putUnlessSuccessLatched(store, scheme, nonce, {
        status: "in_flight",
        startedAt: now(),
      });
      if (latched) {
        return { kind: "settled", result: latched };
      }
      await queue.send({ ...job, mode: "broadcast" });
      return { kind: "enqueued", result };
    }
  }
}

/**
 * Consumer-side retry. The QUEUE is the designated retrier: it may act despite
 * an in_flight lease (it OWNS the retry), but it must respect terminal records
 * and never re-broadcast a tx that already exists.
 *
 *  existing settled                          → ack (already done, no call)
 *  confirm job (or existing awaiting_receipt) → confirm(txHash):
 *      success | transaction_reverted → put settled, ack. Recording a genuinely
 *          reverted tx is NOT an I2 violation — we confirmed the REAL on-chain
 *          outcome, and a revert is a genuine failure.
 *      still settlement_pending_receipt → throw (the Queue retries the confirm
 *          later; the tx is real, we just can't read the receipt yet).
 *  broadcast job → settle():
 *      success | definitive            → put settled, ack
 *      settlement_pending_receipt(h)   → put awaiting_receipt{h}, enqueue a
 *                                        confirm job, ack
 *      transient                       → throw (Queue retries; lease + nonce
 *                                        backstop bound the residual race)
 *
 * Throwing lets the Cloudflare Queue increment the attempt count and (after
 * max_retries) route to the dead-letter queue — we don't re-implement a counter.
 */
export async function retrySettle(args: {
  store: SettlementStore;
  queue: RetryQueue;
  settle: SettleFn;
  confirm: ConfirmFn;
  job: RetryJob;
  now?: () => number;
}): Promise<{ acked: true; result: SettleResponse } | never> {
  const { store, queue, settle, confirm, job } = args;
  const now = args.now ?? Date.now;
  const { scheme, nonce } = job;

  const existing = await store.get(scheme, nonce);
  if (existing && existing.status === "settled") {
    // Already terminal on a prior attempt — ack without any on-chain call.
    return { acked: true, result: existing.result };
  }

  // CONFIRM path: this job is a confirm, or the record says a tx is awaiting its
  // receipt. Either way a tx exists — confirm it, NEVER broadcast (I1).
  const txHash =
    job.mode === "confirm"
      ? job.txHash
      : existing && existing.status === "awaiting_receipt"
        ? existing.txHash
        : undefined;

  if (txHash !== undefined) {
    const result = await confirm(txHash);
    if (classifySettlement(result) === "retry_confirm") {
      // Receipt still unknown — let the Queue retry the confirm later.
      const reason = result.success ? "" : result.errorReason;
      throw new Error(`settle retry pending receipt for ${scheme}/${nonce}: ${reason}`);
    }
    // success OR transaction_reverted → the REAL on-chain outcome; record it. A
    // confirmed REVERT must not clobber a prior settled-success: the single-use
    // nonce means at most one tx succeeded, and a duplicate confirm of the loser
    // could otherwise overwrite the winner (Finding 3 / I2).
    const stored = await putSettledSticky(store, scheme, nonce, result, now());
    return { acked: true, result: stored };
  }

  // BROADCAST path: no tx exists yet. The queue may broadcast despite a lease.
  // We classify directly here (NOT via recordSettleResult) because the Queue
  // itself is the retrier — re-enqueuing on a transient failure would double the
  // message. We throw instead and let the Queue count + dead-letter.
  const result = await settle();
  switch (classifySettlement(result)) {
    case "definitive": {
      // A failure here never clobbers a prior settled-success (Finding 3 / I2).
      const stored = await putSettledSticky(store, scheme, nonce, result, now());
      return { acked: true, result: stored };
    }
    case "retry_confirm": {
      // We just broadcast a tx but couldn't read the receipt. Record
      // awaiting_receipt and hand off a CONFIRM job; ack THIS broadcast message
      // (it has done its job — the tx exists, I1 now applies). If a racing winner
      // already latched success, keep it (I2) and ack without a confirm job.
      const h = pendingReceiptTxHash(result) ?? "";
      const latched = await putUnlessSuccessLatched(store, scheme, nonce, {
        status: "awaiting_receipt",
        txHash: h,
        startedAt: now(),
      });
      if (latched) {
        return { acked: true, result: latched };
      }
      await queue.send({ ...job, mode: "confirm", txHash: h, network: job.network });
      return { acked: true, result };
    }
    case "retry_broadcast": {
      // Still a transient broadcast failure — refresh the lease and throw so the
      // Queue retries / dead-letters this same message (lease + nonce backstop
      // bound any residual race at lease expiry). If a racing winner latched
      // success, keep it (I2) and ack instead of throwing — it's already done.
      const latched = await putUnlessSuccessLatched(store, scheme, nonce, {
        status: "in_flight",
        startedAt: now(),
      });
      if (latched) {
        return { acked: true, result: latched };
      }
      const reason = result.success ? "" : result.errorReason;
      throw new Error(`settle retry transient failure for ${scheme}/${nonce}: ${reason}`);
    }
  }
}
