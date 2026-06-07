/**
 * Durable settlement recording for infer.x402cloud.ai.
 *
 * The payment middleware fires two hooks around every settle call:
 *   - `onSettlementIntent(intent)` — BEFORE the on-chain settle, so a crash
 *     mid-settle leaves a `pending` record to reconcile against.
 *   - `onSettlementResult(outcome)` — AFTER it resolves, success or failure.
 *
 * A `SettlementRecorder` turns those hooks into durable state. The interface is
 * injected (data over mechanism): the Worker uses a KV-backed implementation,
 * tests use the in-memory default. Neither knows about the other.
 *
 * Fail-safe by construction: every write is wrapped so that a missing binding
 * or a thrown KV call is logged and swallowed. Recording is a side-channel for
 * reconciliation — it must NEVER break the response path or the settlement
 * itself.
 */
import type {
  SettlementIntent,
  SettlementOutcome,
} from "@x402cloud/middleware";

/** A durable settlement recorder: records intent before settle, outcome after. */
export type SettlementRecorder = {
  recordIntent(intent: SettlementIntent): Promise<void>;
  recordResult(outcome: SettlementOutcome): Promise<void>;
};

/** The persisted shape of a settlement record (one per intent id). */
export type SettlementRecord =
  | {
      status: "pending";
      intentId: string;
      scheme: string;
      settlementAmount: string;
      createdAt: number;
    }
  | {
      status: "settled";
      intentId: string;
      scheme: string;
      settlementAmount: string;
      transaction: string;
      settledAt: number;
    }
  | {
      status: "failed";
      intentId: string;
      scheme: string;
      settlementAmount: string;
      errorReason: string;
      failedAt: number;
    };

const RECORD_PREFIX = "settlement:";
/** Dead-letter marker for a settlement that was authorized but not collected. */
const DEAD_LETTER_PREFIX = "deadletter:";

export function recordKey(intentId: string): string {
  return `${RECORD_PREFIX}${intentId}`;
}

export function deadLetterKey(intentId: string): string {
  return `${DEAD_LETTER_PREFIX}${intentId}`;
}

/**
 * Minimal KV surface this recorder needs — a structural subset of
 * Cloudflare's KVNamespace. Requiring less than the full binding keeps the
 * recorder testable with a trivial mock.
 */
export type KVPut = {
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
};

/** Records are retained ~30 days; long enough to reconcile, short enough to bound storage. */
const RECORD_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * KV-backed recorder. On intent it writes a `pending` record; on result it
 * overwrites with `settled` or `failed`, and on failure ALSO writes a
 * dead-letter marker so a reconciliation sweep can find uncollected payments
 * without scanning every record.
 *
 * Every write is fail-safe: a thrown KV call is logged and swallowed.
 */
export function createKvRecorder(kv: KVPut): SettlementRecorder {
  async function safePut(
    key: string,
    record: SettlementRecord | { intentId: string; reason: string; at: number },
  ): Promise<void> {
    try {
      await kv.put(key, JSON.stringify(record), {
        expirationTtl: RECORD_TTL_SECONDS,
      });
    } catch (err) {
      // Reconciliation is best-effort; never break the response path.
      console.error(`settlement recorder KV put failed for ${key}:`, err);
    }
  }

  return {
    async recordIntent(intent: SettlementIntent): Promise<void> {
      await safePut(recordKey(intent.id), {
        status: "pending",
        intentId: intent.id,
        scheme: intent.scheme,
        settlementAmount: intent.settlementAmount,
        createdAt: intent.createdAt,
      });
    },

    async recordResult(outcome: SettlementOutcome): Promise<void> {
      const now = Date.now();
      if (outcome.result.success) {
        await safePut(recordKey(outcome.intentId), {
          status: "settled",
          intentId: outcome.intentId,
          scheme: outcome.scheme,
          settlementAmount: outcome.settlementAmount,
          transaction: outcome.result.transaction,
          settledAt: now,
        });
        return;
      }

      // Service delivered, payment NOT collected — overwrite + dead-letter.
      await safePut(recordKey(outcome.intentId), {
        status: "failed",
        intentId: outcome.intentId,
        scheme: outcome.scheme,
        settlementAmount: outcome.settlementAmount,
        errorReason: outcome.result.errorReason,
        failedAt: now,
      });
      await safePut(deadLetterKey(outcome.intentId), {
        intentId: outcome.intentId,
        reason: outcome.result.errorReason,
        at: now,
      });
    },
  };
}

/**
 * In-memory recorder — the default for tests and for any isolate without a KV
 * binding. Keeps the same fail-safe contract: writes can never throw out.
 */
export function createMemoryRecorder(): SettlementRecorder & {
  records: Map<string, SettlementRecord>;
  deadLetters: Map<string, { intentId: string; reason: string; at: number }>;
} {
  const records = new Map<string, SettlementRecord>();
  const deadLetters = new Map<
    string,
    { intentId: string; reason: string; at: number }
  >();

  return {
    records,
    deadLetters,
    async recordIntent(intent: SettlementIntent): Promise<void> {
      records.set(recordKey(intent.id), {
        status: "pending",
        intentId: intent.id,
        scheme: intent.scheme,
        settlementAmount: intent.settlementAmount,
        createdAt: intent.createdAt,
      });
    },
    async recordResult(outcome: SettlementOutcome): Promise<void> {
      const now = Date.now();
      if (outcome.result.success) {
        records.set(recordKey(outcome.intentId), {
          status: "settled",
          intentId: outcome.intentId,
          scheme: outcome.scheme,
          settlementAmount: outcome.settlementAmount,
          transaction: outcome.result.transaction,
          settledAt: now,
        });
        return;
      }
      records.set(recordKey(outcome.intentId), {
        status: "failed",
        intentId: outcome.intentId,
        scheme: outcome.scheme,
        settlementAmount: outcome.settlementAmount,
        errorReason: outcome.result.errorReason,
        failedAt: now,
      });
      deadLetters.set(deadLetterKey(outcome.intentId), {
        intentId: outcome.intentId,
        reason: outcome.result.errorReason,
        at: now,
      });
    },
  };
}
