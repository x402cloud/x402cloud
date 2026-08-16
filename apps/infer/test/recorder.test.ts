import { describe, it, expect, vi } from "vitest";
import type { SettlementIntent, SettlementOutcome } from "@x402cloud/middleware";
import {
  createKvRecorder,
  createMemoryRecorder,
  recordKey,
  deadLetterKey,
  type KVPut,
  type SettlementRecord,
} from "../src/recorder.js";
import { buildSettlementOptions } from "../src/index.js";

const REQS = {
  scheme: "upto" as const,
  network: "eip155:84532" as const,
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "10000",
  payTo: "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88",
  maxTimeoutSeconds: 300,
};

function intent(id: string): SettlementIntent {
  return {
    id,
    payload: { signature: "0xsig" },
    requirements: REQS,
    settlementAmount: "5000",
    scheme: "upto",
    createdAt: 1_700_000_000_000,
  };
}

function successOutcome(intentId: string): SettlementOutcome {
  return {
    intentId,
    scheme: "upto",
    requirements: REQS,
    settlementAmount: "5000",
    result: { success: true, transaction: "0xtx", network: "eip155:84532", settledAmount: "5000" },
  };
}

function failureOutcome(intentId: string): SettlementOutcome {
  return {
    intentId,
    scheme: "upto",
    requirements: REQS,
    settlementAmount: "5000",
    result: { success: false, errorReason: "settlement_failed: nonce already used" },
  };
}

/** A trivial in-memory mock that satisfies the KVPut surface and lets tests inspect/throw. */
function mockKv(opts: { throwOnPut?: boolean } = {}): KVPut & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async put(key: string, value: string) {
      if (opts.throwOnPut) throw new Error("KV unavailable");
      store.set(key, value);
    },
  };
}

describe("createKvRecorder", () => {
  it("writes a pending record on intent", async () => {
    const kv = mockKv();
    const rec = createKvRecorder(kv);
    await rec.recordIntent(intent("abc"));

    const raw = kv.store.get(recordKey("abc"));
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw!) as SettlementRecord;
    expect(record.status).toBe("pending");
    expect(record.intentId).toBe("abc");
    expect(record.settlementAmount).toBe("5000");
  });

  it("overwrites pending with settled on a successful result", async () => {
    const kv = mockKv();
    const rec = createKvRecorder(kv);
    await rec.recordIntent(intent("abc"));
    await rec.recordResult(successOutcome("abc"));

    const record = JSON.parse(kv.store.get(recordKey("abc"))!) as SettlementRecord;
    expect(record.status).toBe("settled");
    if (record.status === "settled") {
      expect(record.transaction).toBe("0xtx");
    }
    // No dead-letter for a success.
    expect(kv.store.has(deadLetterKey("abc"))).toBe(false);
  });

  it("overwrites with failed AND writes a dead-letter on a failed result", async () => {
    const kv = mockKv();
    const rec = createKvRecorder(kv);
    await rec.recordIntent(intent("abc"));
    await rec.recordResult(failureOutcome("abc"));

    const record = JSON.parse(kv.store.get(recordKey("abc"))!) as SettlementRecord;
    expect(record.status).toBe("failed");
    if (record.status === "failed") {
      expect(record.errorReason).toContain("nonce already used");
    }

    const dl = kv.store.get(deadLetterKey("abc"));
    expect(dl, "failed settlement must be dead-lettered for reconciliation").toBeTruthy();
    const parsed = JSON.parse(dl!) as { intentId: string; reason: string };
    expect(parsed.intentId).toBe("abc");
    expect(parsed.reason).toContain("nonce already used");
  });

  it("is fail-safe: a throwing KV put is logged and swallowed, never rethrown", async () => {
    const kv = mockKv({ throwOnPut: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = createKvRecorder(kv);

    // Neither call should reject.
    await expect(rec.recordIntent(intent("abc"))).resolves.toBeUndefined();
    await expect(rec.recordResult(failureOutcome("abc"))).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("createMemoryRecorder (test/no-KV default)", () => {
  it("records intent then settled result in memory", async () => {
    const rec = createMemoryRecorder();
    await rec.recordIntent(intent("m1"));
    expect(rec.records.get(recordKey("m1"))?.status).toBe("pending");

    await rec.recordResult(successOutcome("m1"));
    expect(rec.records.get(recordKey("m1"))?.status).toBe("settled");
    expect(rec.deadLetters.size).toBe(0);
  });

  it("dead-letters a failed result", async () => {
    const rec = createMemoryRecorder();
    await rec.recordIntent(intent("m2"));
    await rec.recordResult(failureOutcome("m2"));

    expect(rec.records.get(recordKey("m2"))?.status).toBe("failed");
    expect(rec.deadLetters.get(deadLetterKey("m2"))?.reason).toContain("nonce already used");
  });
});

describe("buildSettlementOptions (production wiring)", () => {
  const BASE_ENV = { AI: {} as never, NETWORK: "base-sepolia", FACILITATOR_URL: "https://f.test" };

  it("returns undefined (true no-op) when no SETTLEMENTS binding is present", () => {
    expect(buildSettlementOptions(BASE_ENV)).toBeUndefined();
  });

  it("wires both hooks to a KV recorder when the binding is present", async () => {
    const kv = mockKv();
    const options = buildSettlementOptions({ ...BASE_ENV, SETTLEMENTS: kv });
    expect(options).toBeDefined();
    expect(typeof options!.onSettlementIntent).toBe("function");
    expect(typeof options!.onSettlementResult).toBe("function");

    // Hooks delegate to the recorder, persisting intent then dead-lettering a failure.
    await options!.onSettlementIntent!(intent("w1"));
    expect(JSON.parse(kv.store.get(recordKey("w1"))!).status).toBe("pending");

    await options!.onSettlementResult!(failureOutcome("w1"));
    expect(JSON.parse(kv.store.get(recordKey("w1"))!).status).toBe("failed");
    expect(kv.store.has(deadLetterKey("w1"))).toBe(true);
  });
});
