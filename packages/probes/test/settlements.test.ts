import { describe, it, expect } from "vitest";
import { summarizeSettlements, type KVList } from "../src/settlements.js";

const NOW = 1_700_100_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** A trivial in-memory KV mock — list + get only, matching KVList. */
function mockKv(records: Record<string, unknown>): KVList {
  const entries = Object.entries(records);
  return {
    async list({ cursor } = {}) {
      const start = cursor ? Number(cursor) : 0;
      const page = entries.slice(start, start + 1); // force pagination in tests
      const next = start + page.length;
      return {
        keys: page.map(([name]) => ({ name })),
        list_complete: next >= entries.length,
        cursor: next >= entries.length ? undefined : String(next),
      };
    },
    async get(key: string) {
      const found = entries.find(([name]) => name === key);
      return found ? JSON.stringify(found[1]) : null;
    },
  };
}

describe("summarizeSettlements", () => {
  it("reports unavailable when no KV binding is given", async () => {
    const result = await summarizeSettlements(undefined);
    expect(result).toEqual({ available: false });
  });

  it("counts settled/failed/pending within the window and excludes older records", async () => {
    const kv = mockKv({
      "settlement:a": { status: "settled", settledAt: NOW - 1000 },
      "settlement:b": { status: "failed", failedAt: NOW - 2000 },
      "settlement:c": { status: "pending", createdAt: NOW - 3000 },
      "settlement:old": { status: "settled", settledAt: NOW - 2 * DAY },
    });

    const result = await summarizeSettlements(kv, { now: NOW, windowMs: DAY });
    expect(result).toEqual({
      available: true,
      windowHours: 24,
      settled: 1,
      failed: 1,
      pending: 1,
      total: 3,
      truncated: false,
    });
  });

  it("ignores keys with unparsable or unrecognised values instead of throwing", async () => {
    const kv = mockKv({
      "settlement:bad-json": "{not json",
      "settlement:no-status": { foo: "bar" },
      "settlement:good": { status: "settled", settledAt: NOW - 500 },
    });

    const result = await summarizeSettlements(kv, { now: NOW });
    expect(result).toEqual({
      available: true,
      windowHours: 24,
      settled: 1,
      failed: 0,
      pending: 0,
      total: 1,
      truncated: false,
    });
  });

  it("stops scanning and reports truncated once maxKeys is hit", async () => {
    const records: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      records[`settlement:${i}`] = { status: "settled", settledAt: NOW - 100 };
    }
    const kv = mockKv(records);

    const result = await summarizeSettlements(kv, { now: NOW, maxKeys: 3 });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.truncated).toBe(true);
      expect(result.total).toBe(3);
    }
  });
});
