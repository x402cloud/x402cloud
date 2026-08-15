/**
 * Settlement health: summarises the durable settlement records a paid
 * service (e.g. apps/infer) writes to its `SETTLEMENTS` KV namespace (see
 * apps/infer/src/recorder.ts) into a 24h pass/fail rollup for the ops
 * dashboard.
 *
 * This module knows only the JSON shape of a settlement record — it never
 * imports from `apps/infer` (packages must have zero deps on apps). The
 * record shape below is a structural mirror of `SettlementRecord` in
 * `apps/infer/src/recorder.ts`; if that shape changes, update
 * `isSettlementRecord`/`recordTimestamp` here to match.
 *
 * Degrades gracefully by construction: no KV binding in, `{ available: false }`
 * out — no network call, no fabricated numbers.
 */

export type SettlementSummary =
  | { available: false }
  | {
      available: true;
      windowHours: number;
      settled: number;
      failed: number;
      pending: number;
      total: number;
      /** true if the scan hit `maxKeys` before covering every key under the prefix. */
      truncated: boolean;
    };

/**
 * Minimal structural subset of Cloudflare's KVNamespace this module needs —
 * list + get, read-only. Requiring less than the full binding keeps this
 * testable with a trivial in-memory mock and documents, in the type itself,
 * that settlement health never writes.
 */
export type KVList = {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
  get(key: string): Promise<string | null>;
};

const SETTLEMENT_PREFIX = "settlement:";
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_KEYS = 2000;
const LIST_PAGE_SIZE = 1000;

type RawSettlementRecord = {
  status: "pending" | "settled" | "failed";
  createdAt?: number;
  settledAt?: number;
  failedAt?: number;
};

function isSettlementRecord(value: unknown): value is RawSettlementRecord {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return status === "pending" || status === "settled" || status === "failed";
}

/** The timestamp a record's status transitioned — what "in the last 24h" filters on. */
function recordTimestamp(record: RawSettlementRecord): number {
  if (record.status === "settled") return record.settledAt ?? 0;
  if (record.status === "failed") return record.failedAt ?? 0;
  return record.createdAt ?? 0;
}

export async function summarizeSettlements(
  kv: KVList | undefined,
  opts: { windowMs?: number; now?: number; maxKeys?: number } = {},
): Promise<SettlementSummary> {
  if (!kv) return { available: false };

  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = opts.now ?? Date.now();
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  const cutoff = now - windowMs;

  let settled = 0;
  let failed = 0;
  let pending = 0;
  let scanned = 0;
  let truncated = false;
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: SETTLEMENT_PREFIX, cursor, limit: LIST_PAGE_SIZE });

    const budget = maxKeys - scanned;
    const namesThisPage = page.keys.slice(0, Math.max(budget, 0)).map((k) => k.name);
    if (namesThisPage.length < page.keys.length) truncated = true;
    scanned += namesThisPage.length;

    const values = await Promise.all(namesThisPage.map((name) => kv.get(name)));
    for (const raw of values) {
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isSettlementRecord(parsed)) continue;
      if (recordTimestamp(parsed) < cutoff) continue;

      if (parsed.status === "settled") settled++;
      else if (parsed.status === "failed") failed++;
      else pending++;
    }

    cursor = truncated || page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return {
    available: true,
    windowHours: Math.round(windowMs / 3_600_000),
    settled,
    failed,
    pending,
    total: settled + failed + pending,
    truncated,
  };
}
