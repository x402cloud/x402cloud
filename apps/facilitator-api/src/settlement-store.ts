import { DurableObject } from "cloudflare:workers";
import type { Network, SettleResponse } from "@x402cloud/protocol";
import { classifySettlement, pendingReceiptTxHash } from "@x402cloud/facilitator";

/**
 * Durable settlement orchestration for the hosted facilitator.
 *
 * The pure on-chain settle/confirm logic lives in @x402cloud/evm and must stay
 * pure (no storage, no queues). The pure 3-way classifier lives in
 * @x402cloud/facilitator. Durability — idempotency + retry — is an *app*
 * concern, so it lives here. We inject a single COORDINATOR port (a structural
 * record of compound atomic operations), which keeps this module testable with
 * plain mocks and lets the worker swap a Durable Object for KV (or anything that
 * satisfies the shape).
 *
 *   settle/confirm (pure) + classify (pure) + coordinator → durable settle
 *
 * ── Idempotency boundary ──
 * We key on (scheme, nonce). upto and exact use DIFFERENT proxy contracts with
 * INDEPENDENT Permit2 nonce bitmaps, so the same nonce value can be two distinct
 * valid authorizations. The idempotency key MUST match the on-chain uniqueness
 * boundary, hence (scheme, nonce) — not nonce alone.
 *
 * ── The coordinator closes the read→write TOCTOU ──
 * The orchestrator never does a raw get-then-put guard. Instead it calls COMPOUND
 * coordinator ops (claim, recordTerminal, recordAwaitingReceipt,
 * recordBroadcastRetry) that each perform read-modify-write in ONE call. The KEY
 * property is that each op is ATOMIC per (scheme, nonce):
 *
 *   - durableObjectCoordinator routes every op for a (scheme, nonce) to the SAME
 *     single-threaded Durable Object (idFromName(`scheme:nonce`)). The DO input
 *     gate serializes calls and its storage is transactional + strongly
 *     consistent, so each op is a real atomic read-modify-write. This gives a HARD
 *     exactly-once-RECORDED guarantee: the lease, the sticky-success latch, and
 *     the awaiting_receipt confirm-only rule become genuine invariants, not
 *     narrowed races.
 *   - kvCoordinator runs the same ops over KV using re-read guards. KV has no
 *     compare-and-set, so it NARROWS each read→write TOCTOU window but CANNOT
 *     eliminate it. It exists for self-hosters without Durable Objects; the
 *     hosted worker defaults to the DO.
 *
 * In BOTH cases the single-use on-chain Permit2 nonce is the ultimate
 * double-spend backstop: even if two attempts race past the app layer, only ONE
 * on-chain settle() can consume the nonce; the other reverts. A DOUBLE CHARGE is
 * impossible regardless. The coordinator's job is to AVOID wasted gas, corrupted
 * records, and lost revenue — and with the DO that becomes a hard guarantee.
 *
 * The on-chain settle()/confirm() always runs in the Worker BETWEEN claim() and
 * the record*() calls — NEVER inside a coordinator op. A coordinator op is a
 * short storage read+write with no long awaits, so the DO's input/output gates
 * keep it atomic.
 *
 * ── Two invariants (violating either is a money bug) ──
 * I1. Once a txHash exists for a (scheme, nonce), NEVER settle()/re-broadcast
 *     again — only CONFIRM the known txHash. Re-broadcast reverts on the
 *     single-use nonce, wastes gas, and gets recorded as a failure even though
 *     the original tx already charged the payer = LOST REVENUE.
 * I2. A settlement that actually succeeded on-chain must NEVER be recorded or
 *     returned as failed (sticky-success latch: success may always latch; a
 *     failure never clobbers a success).
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

/** True if a stored record is a terminal, on-chain SUCCESS. */
function isSettledSuccess(record: SettlementRecord | null): boolean {
  return record !== null && record.status === "settled" && record.result.success === true;
}

/** Narrow a record we already know to be a settled-success to its result. */
function settledResult(record: SettlementRecord): SettleResponse {
  return (record as { status: "settled"; result: SettleResponse }).result;
}

// ── Coordinator port ─────────────────────────────────────────────────────────

/**
 * The outcome of a claim attempt. Each value already reflects an ATOMIC decision:
 *   replay    → a terminal settled record exists; do NO on-chain call.
 *   awaiting  → an awaiting_receipt record exists; a tx is real, CONFIRM only (I1).
 *   in_flight → a valid lease is held by another attempt; do NOT broadcast.
 *   proceed   → no record OR an expired lease — the coordinator has ATOMICALLY
 *               written in_flight{startedAt:now}; the caller may now broadcast.
 */
export type ClaimOutcome =
  | { action: "replay"; result: SettleResponse }
  | { action: "awaiting"; txHash: string }
  | { action: "in_flight" }
  | { action: "proceed" };

/**
 * Atomic settlement coordinator. Each method is a COMPOUND atomic operation
 * (read-modify-write in one call), atomic per (scheme, nonce). This replaces the
 * raw get/put/delete guard sequences the orchestrator used to inline.
 *
 * IMPORTANT: the on-chain settle()/confirm() runs in the Worker BETWEEN claim()
 * and the record*() calls — never inside a coordinator op. Ops do NO long awaits
 * and NO network/on-chain work, so a Durable Object's input/output gates keep
 * them atomic.
 */
export type SettlementCoordinator = {
  /**
   * Atomically read the record and decide. If there is no record OR the in_flight
   * lease has expired, ATOMICALLY write in_flight{startedAt:now} and return
   * {action:"proceed"}. Otherwise return replay / awaiting / in_flight. This one
   * op replaces the top-read + lease-check + in_flight claim, closing the claim
   * race.
   */
  claim(scheme: Scheme, nonce: string, now: number): Promise<ClaimOutcome>;
  /**
   * Atomically apply the sticky-success latch (I2). If an existing settled-success
   * is present and `result` is a failure, KEEP the success and return it.
   * Otherwise write settled{result} and return `result`. A success always latches;
   * a failure never clobbers a success.
   */
  recordTerminal(scheme: Scheme, nonce: string, result: SettleResponse, now: number): Promise<SettleResponse>;
  /**
   * Atomic: if a settled-success is already latched, return it (caller
   * short-circuits — I2). Otherwise write awaiting_receipt{txHash} and return null.
   */
  recordAwaitingReceipt(scheme: Scheme, nonce: string, txHash: string, now: number): Promise<SettleResponse | null>;
  /**
   * Atomic: if a settled-success is latched, return it (I2). Otherwise refresh the
   * lease — write in_flight{startedAt:now} (KEEP the lease, BUG-4 behavior) — and
   * return null.
   */
  recordBroadcastRetry(scheme: Scheme, nonce: string, now: number): Promise<SettleResponse | null>;
  /** Read the record (tests / observability). */
  get(scheme: Scheme, nonce: string): Promise<SettlementRecord | null>;
};

// ── Pure op logic ─────────────────────────────────────────────────────────────
//
// The decision each coordinator op makes is a PURE function of the current
// record + inputs → {nextRecord?, returned}. Both the DO and the KV adapter run
// this exact logic; they differ only in HOW they make the read+write atomic (DO:
// single-threaded transactional storage; KV: a re-read guard that narrows but
// cannot eliminate the window). Keeping the decision pure means the state machine
// lives in ONE place — accretion, not duplication.

type OpStep = {
  /** Record to persist, or undefined to leave storage unchanged. */
  next?: SettlementRecord;
};

/** claim(): decide from the current record; write in_flight on proceed. */
function claimStep(current: SettlementRecord | null, now: number): { outcome: ClaimOutcome } & OpStep {
  if (current) {
    if (current.status === "settled") {
      return { outcome: { action: "replay", result: current.result } };
    }
    if (current.status === "awaiting_receipt") {
      // A tx is already broadcast — NEVER re-broadcast (I1). awaiting_receipt does
      // NOT lease-expire; it always resolves via confirm().
      return { outcome: { action: "awaiting", txHash: current.txHash } };
    }
    // in_flight: respect a valid lease; reclaim an expired one (BUG 2).
    if (leaseValid(current.startedAt, now)) {
      return { outcome: { action: "in_flight" } };
    }
    // else fall through and reclaim the stale lease.
  }
  // No record or expired lease → claim it before any on-chain work.
  return { outcome: { action: "proceed" }, next: { status: "in_flight", startedAt: now } };
}

/** recordTerminal(): sticky-success latch (I2). */
function recordTerminalStep(
  current: SettlementRecord | null,
  result: SettleResponse,
  now: number,
): { returned: SettleResponse } & OpStep {
  if (!result.success && isSettledSuccess(current)) {
    // Never clobber a real success with a failure.
    return { returned: settledResult(current as SettlementRecord) };
  }
  return { returned: result, next: { status: "settled", result, settledAt: now } };
}

/** recordAwaitingReceipt(): write awaiting_receipt unless a success is latched. */
function recordAwaitingStep(
  current: SettlementRecord | null,
  txHash: string,
  now: number,
): { returned: SettleResponse | null } & OpStep {
  if (isSettledSuccess(current)) {
    return { returned: settledResult(current as SettlementRecord) };
  }
  return { returned: null, next: { status: "awaiting_receipt", txHash, startedAt: now } };
}

/** recordBroadcastRetry(): refresh the lease unless a success is latched. */
function recordBroadcastRetryStep(
  current: SettlementRecord | null,
  now: number,
): { returned: SettleResponse | null } & OpStep {
  if (isSettledSuccess(current)) {
    return { returned: settledResult(current as SettlementRecord) };
  }
  return { returned: null, next: { status: "in_flight", startedAt: now } };
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

/**
 * A low-level idempotency store (raw get/put/delete on SettlementRecord). KV in
 * production, a Map in tests. The coordinator ops are built ON TOP of this — the
 * store itself is dumb storage; the coordinator adds the atomic read-modify-write
 * semantics (real on the DO, narrowed on KV).
 */
export type SettlementStore = {
  get(scheme: Scheme, nonce: string): Promise<SettlementRecord | null>;
  put(scheme: Scheme, nonce: string, record: SettlementRecord): Promise<void>;
  delete(scheme: Scheme, nonce: string): Promise<void>;
};

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

/**
 * Build a coordinator over a raw SettlementStore (KV). Each op is read → pure
 * step → conditional put. KV has no compare-and-set, so this NARROWS the
 * read→write TOCTOU window but CANNOT eliminate it (a racing winner may latch a
 * success between this read and put). The single-use on-chain nonce remains the
 * ultimate double-charge backstop, and the pure steps preserve the EXACT state
 * machine the DO enforces atomically. Self-hosters without Durable Objects get
 * the prior narrowed-residual behavior; the hosted worker uses the DO.
 */
export function kvCoordinator(store: SettlementStore): SettlementCoordinator {
  return {
    async claim(scheme, nonce, now) {
      const current = await store.get(scheme, nonce);
      const { outcome, next } = claimStep(current, now);
      if (next) await store.put(scheme, nonce, next);
      return outcome;
    },
    async recordTerminal(scheme, nonce, result, now) {
      const current = await store.get(scheme, nonce);
      const { returned, next } = recordTerminalStep(current, result, now);
      if (next) await store.put(scheme, nonce, next);
      return returned;
    },
    async recordAwaitingReceipt(scheme, nonce, txHash, now) {
      const current = await store.get(scheme, nonce);
      const { returned, next } = recordAwaitingStep(current, txHash, now);
      if (next) await store.put(scheme, nonce, next);
      return returned;
    },
    async recordBroadcastRetry(scheme, nonce, now) {
      const current = await store.get(scheme, nonce);
      const { returned, next } = recordBroadcastRetryStep(current, now);
      if (next) await store.put(scheme, nonce, next);
      return returned;
    },
    get(scheme, nonce) {
      return store.get(scheme, nonce);
    },
  };
}

/** Convenience: a KV-backed coordinator straight from a KVNamespace. */
export function kvCoordinatorFromKv(kv: KvLike): SettlementCoordinator {
  return kvCoordinator(kvSettlementStore(kv));
}

// ── Durable Object adapter ─────────────────────────────────────────────────

/** The single storage key inside each per-(scheme,nonce) DO instance. */
const DO_RECORD_KEY = "record";

/**
 * One DO instance per (scheme, nonce). Cloudflare runs each instance
 * single-threaded with transactional, strongly-consistent storage, and serializes
 * inbound calls behind the input gate. So every RPC method below is a genuine
 * ATOMIC read-modify-write — no two ops for the same nonce interleave. This is
 * what upgrades the lease + sticky-success latch from "narrowed race" (KV) to a
 * hard invariant.
 *
 * Each method reads the record, runs the SAME pure step the KV adapter runs, and
 * conditionally writes — no on-chain calls, no long awaits, so the op never
 * straddles the gate.
 */
export class SettlementDO extends DurableObject {
  private read(): Promise<SettlementRecord | null> {
    return this.ctx.storage.get<SettlementRecord>(DO_RECORD_KEY).then((r) => r ?? null);
  }

  async claim(now: number): Promise<ClaimOutcome> {
    const current = await this.read();
    const { outcome, next } = claimStep(current, now);
    if (next) await this.ctx.storage.put(DO_RECORD_KEY, next);
    return outcome;
  }

  async recordTerminal(result: SettleResponse, now: number): Promise<SettleResponse> {
    const current = await this.read();
    const { returned, next } = recordTerminalStep(current, result, now);
    if (next) await this.ctx.storage.put(DO_RECORD_KEY, next);
    return returned;
  }

  async recordAwaitingReceipt(txHash: string, now: number): Promise<SettleResponse | null> {
    const current = await this.read();
    const { returned, next } = recordAwaitingStep(current, txHash, now);
    if (next) await this.ctx.storage.put(DO_RECORD_KEY, next);
    return returned;
  }

  async recordBroadcastRetry(now: number): Promise<SettleResponse | null> {
    const current = await this.read();
    const { returned, next } = recordBroadcastRetryStep(current, now);
    if (next) await this.ctx.storage.put(DO_RECORD_KEY, next);
    return returned;
  }

  getRecord(): Promise<SettlementRecord | null> {
    return this.read();
  }
}

/**
 * Minimal DO-namespace surface we rely on: address an instance by name and call
 * its RPC methods. Matches Cloudflare's DurableObjectNamespace<SettlementDO> but
 * stated structurally so this module stays testable without the full runtime
 * (the same pattern apps/sandbox uses).
 */
export type SettlementDONamespace = {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): {
    claim(now: number): Promise<ClaimOutcome>;
    recordTerminal(result: SettleResponse, now: number): Promise<SettleResponse>;
    recordAwaitingReceipt(txHash: string, now: number): Promise<SettleResponse | null>;
    recordBroadcastRetry(now: number): Promise<SettleResponse | null>;
    getRecord(): Promise<SettlementRecord | null>;
  };
};

/** The name that routes all ops for one nonce to the SAME DO instance. */
function doName(scheme: Scheme, nonce: string): string {
  return `${scheme}:${nonce}`;
}

/**
 * Build a coordinator backed by a SettlementDO namespace. Every op for a given
 * (scheme, nonce) is dispatched to the SAME DO instance (idFromName), whose
 * single-threaded transactional storage makes each op a real atomic
 * read-modify-write — the hard exactly-once-recorded guarantee. This is the
 * DEFAULT for the hosted worker.
 */
export function durableObjectCoordinator(namespace: SettlementDONamespace): SettlementCoordinator {
  const stub = (scheme: Scheme, nonce: string) => namespace.get(namespace.idFromName(doName(scheme, nonce)));
  return {
    claim(scheme, nonce, now) {
      return stub(scheme, nonce).claim(now);
    },
    recordTerminal(scheme, nonce, result, now) {
      return stub(scheme, nonce).recordTerminal(result, now);
    },
    recordAwaitingReceipt(scheme, nonce, txHash, now) {
      return stub(scheme, nonce).recordAwaitingReceipt(txHash, now);
    },
    recordBroadcastRetry(scheme, nonce, now) {
      return stub(scheme, nonce).recordBroadcastRetry(now);
    },
    get(scheme, nonce) {
      return stub(scheme, nonce).getRecord();
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

/** The pending-receipt SettleResponse surfaced when a tx exists but isn't confirmed. */
function pendingReceiptResponse(txHash: string): SettleResponse {
  return { success: false, errorReason: `settlement_pending_receipt: ${txHash}` };
}

/**
 * Settle durably, keyed on (scheme, nonce), via the atomic coordinator.
 *
 *  claim() → replay              → return replayed, NO on-chain call (idempotency)
 *  claim() → awaiting{txHash}    → return awaiting_confirmation, NO broadcast (a
 *                                  confirm job already exists; the tx is real) (I1)
 *  claim() → in_flight           → return in_flight, NO broadcast (valid lease)
 *  claim() → proceed             → coordinator already wrote in_flight{now} atomically;
 *                                  call settle():
 *     - success | definitive          → recordTerminal; return settled
 *     - settlement_pending_receipt(h) → recordAwaitingReceipt{h}; enqueue a
 *                                       CONFIRM job; return awaiting_confirmation
 *     - transient (no tx)             → recordBroadcastRetry (KEEP the lease,
 *                                       BUG 4 fix); enqueue a BROADCAST job;
 *                                       return enqueued
 *
 * Because claim() atomically writes the in_flight lease before returning proceed,
 * a concurrent attempt cannot also proceed — it sees in_flight (DO) — closing the
 * claim race. On a transient broadcast failure we do NOT delete the marker (the
 * old code did — BUG 4); recordBroadcastRetry keeps the lease so a concurrent
 * client sees in_flight and the QUEUE owns the retry.
 */
export async function settleWithIdempotency(args: {
  coordinator: SettlementCoordinator;
  queue: RetryQueue;
  settle: SettleFn;
  job: RetryJob;
  now?: () => number;
}): Promise<DurableSettleOutcome> {
  const { coordinator, queue, settle, job } = args;
  const now = args.now ?? Date.now;
  const { scheme, nonce } = job;

  const claim = await coordinator.claim(scheme, nonce, now());
  switch (claim.action) {
    case "replay":
      return { kind: "replayed", result: claim.result };
    case "awaiting":
      // A tx is already broadcast — NEVER re-broadcast (I1). A confirm job is in
      // flight; tell the caller it's pending.
      return { kind: "awaiting_confirmation", result: pendingReceiptResponse(claim.txHash) };
    case "in_flight":
      return { kind: "in_flight" };
    case "proceed":
      break;
  }

  // The lease is now held (claim wrote in_flight atomically). Do the on-chain
  // work OUTSIDE any coordinator op, then record the outcome.
  const result = await settle();
  return recordSettleResult({ coordinator, queue, job, result, now });
}

/**
 * Map a fresh settle() result onto a stored record + outcome. The pure 3-way
 * classifier decides; each branch persists via an ATOMIC coordinator op so a
 * racing winner's settled-success is never demoted (I2).
 */
async function recordSettleResult(args: {
  coordinator: SettlementCoordinator;
  queue: RetryQueue;
  job: RetryJob;
  result: SettleResponse;
  now: () => number;
}): Promise<DurableSettleOutcome> {
  const { coordinator, queue, job, result, now } = args;
  const { scheme, nonce } = job;

  switch (classifySettlement(result)) {
    case "definitive": {
      // success OR definitive failure → terminal; record and return. Writing a
      // FAILURE never clobbers a prior settled-success (I2).
      const stored = await coordinator.recordTerminal(scheme, nonce, result, now());
      return { kind: "settled", result: stored };
    }
    case "retry_confirm": {
      // A tx WAS broadcast; only the receipt is unknown. Record awaiting_receipt
      // and hand off a CONFIRM job — NEVER a broadcast (I1). But if a racing winner
      // already latched success for this nonce, our same-nonce tx will revert; keep
      // the success (I2) and skip the pointless confirm job.
      const txHash = pendingReceiptTxHash(result) ?? "";
      const latched = await coordinator.recordAwaitingReceipt(scheme, nonce, txHash, now());
      if (latched) {
        return { kind: "settled", result: latched };
      }
      await queue.send({ ...job, mode: "confirm", txHash, network: job.network });
      return { kind: "awaiting_confirmation", result };
    }
    case "retry_broadcast": {
      // Transient broadcast failure: NO tx exists. KEEP/refresh the lease (BUG 4)
      // so a concurrent client sees in_flight and returns pending; the QUEUE owns
      // the retry as a broadcast job. But never demote a racing winner's
      // settled-success (I2).
      const latched = await coordinator.recordBroadcastRetry(scheme, nonce, now());
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
 *      success | transaction_reverted → recordTerminal, ack. Recording a genuinely
 *          reverted tx is NOT an I2 violation — we confirmed the REAL on-chain
 *          outcome, and a revert is a genuine failure.
 *      still settlement_pending_receipt → throw (the Queue retries the confirm
 *          later; the tx is real, we just can't read the receipt yet).
 *  broadcast job → settle():
 *      success | definitive            → recordTerminal, ack
 *      settlement_pending_receipt(h)   → recordAwaitingReceipt{h}, enqueue a
 *                                        confirm job, ack
 *      transient                       → recordBroadcastRetry then throw (Queue
 *                                        retries; lease + nonce backstop bound the
 *                                        residual race)
 *
 * Throwing lets the Cloudflare Queue increment the attempt count and (after
 * max_retries) route to the dead-letter queue — we don't re-implement a counter.
 */
export async function retrySettle(args: {
  coordinator: SettlementCoordinator;
  queue: RetryQueue;
  settle: SettleFn;
  confirm: ConfirmFn;
  job: RetryJob;
  now?: () => number;
}): Promise<{ acked: true; result: SettleResponse } | never> {
  const { coordinator, queue, settle, confirm, job } = args;
  const now = args.now ?? Date.now;
  const { scheme, nonce } = job;

  const existing = await coordinator.get(scheme, nonce);
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
    // could otherwise overwrite the winner (I2). recordTerminal is the latch.
    const stored = await coordinator.recordTerminal(scheme, nonce, result, now());
    return { acked: true, result: stored };
  }

  // BROADCAST path: no tx exists yet. The queue may broadcast despite a lease.
  // We classify directly here (NOT via recordSettleResult) because the Queue
  // itself is the retrier — re-enqueuing on a transient failure would double the
  // message. We throw instead and let the Queue count + dead-letter.
  const result = await settle();
  switch (classifySettlement(result)) {
    case "definitive": {
      // A failure here never clobbers a prior settled-success (I2).
      const stored = await coordinator.recordTerminal(scheme, nonce, result, now());
      return { acked: true, result: stored };
    }
    case "retry_confirm": {
      // We just broadcast a tx but couldn't read the receipt. Record
      // awaiting_receipt and hand off a CONFIRM job; ack THIS broadcast message
      // (it has done its job — the tx exists, I1 now applies). If a racing winner
      // already latched success, keep it (I2) and ack without a confirm job.
      const h = pendingReceiptTxHash(result) ?? "";
      const latched = await coordinator.recordAwaitingReceipt(scheme, nonce, h, now());
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
      const latched = await coordinator.recordBroadcastRetry(scheme, nonce, now());
      if (latched) {
        return { acked: true, result: latched };
      }
      const reason = result.success ? "" : result.errorReason;
      throw new Error(`settle retry transient failure for ${scheme}/${nonce}: ${reason}`);
    }
  }
}
