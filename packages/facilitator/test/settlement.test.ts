import { describe, it, expect } from "vitest";
import type { SettleResponse } from "@x402cloud/protocol";
import {
  isTransientFailure,
  classifySettlement,
  pendingReceiptTxHash,
} from "../src/settlement.js";

const ok: SettleResponse = {
  success: true,
  transaction: "0xtx",
  network: "eip155:84532",
  settledAmount: "5000",
};

function fail(errorReason: string): SettleResponse {
  return { success: false, errorReason };
}

describe("isTransientFailure", () => {
  it("returns false for a successful settlement (nothing to retry)", () => {
    expect(isTransientFailure(ok)).toBe(false);
  });

  describe("definitive failures (never retry)", () => {
    it("tampered_payload", () => {
      expect(isTransientFailure(fail("tampered_payload"))).toBe(false);
    });

    it("signature_check_failed", () => {
      expect(isTransientFailure(fail("signature_check_failed"))).toBe(false);
    });

    it("settlement_exceeds_authorization", () => {
      expect(isTransientFailure(fail("settlement_exceeds_authorization"))).toBe(false);
    });

    it("transaction_reverted with a tx hash suffix", () => {
      expect(isTransientFailure(fail("transaction_reverted: 0xabc123"))).toBe(false);
    });

    it("transaction_reverted without a suffix", () => {
      expect(isTransientFailure(fail("transaction_reverted"))).toBe(false);
    });
  });

  describe("transient failures (retry)", () => {
    it("settlement_failed with an RPC error message", () => {
      expect(
        isTransientFailure(fail("settlement_failed: HTTP request failed (503)")),
      ).toBe(true);
    });

    it("settlement_failed with a network timeout message", () => {
      expect(
        isTransientFailure(fail("settlement_failed: fetch failed")),
      ).toBe(true);
    });

    it("unrecognised errorReason fails open to retry", () => {
      expect(isTransientFailure(fail("some_future_error"))).toBe(true);
    });

    it("empty errorReason fails open to retry", () => {
      expect(isTransientFailure(fail(""))).toBe(true);
    });
  });

  it("does not treat a string that merely contains a definitive token as definitive", () => {
    // Only a leading-token / exact match is definitive — a settlement_failed
    // message that happens to mention 'transaction_reverted' in its text is
    // still a transient RPC failure.
    expect(
      isTransientFailure(
        fail("settlement_failed: node says transaction_reverted somewhere"),
      ),
    ).toBe(true);
  });

  it("does NOT classify settlement_pending_receipt as re-broadcastable transient", () => {
    // The tx is already broadcast — re-broadcasting would double-spend the
    // single-use nonce. It must be confirmed, not retried via isTransientFailure.
    expect(isTransientFailure(fail("settlement_pending_receipt: 0xabc"))).toBe(false);
  });
});

describe("classifySettlement (3-way)", () => {
  it("success → definitive (nothing to retry)", () => {
    expect(classifySettlement(ok)).toBe("definitive");
  });

  it("settlement_pending_receipt → retry_confirm (NOT retry_broadcast)", () => {
    expect(classifySettlement(fail("settlement_pending_receipt: 0xabc123"))).toBe(
      "retry_confirm",
    );
  });

  it("settlement_pending_receipt WITHOUT a hash → retry_broadcast (no tx to confirm)", () => {
    // Cleanup: the bare token has no parseable hash, so confirm("") would loop
    // forever. With no known tx, re-broadcast is the only way forward — and this
    // must agree with pendingReceiptTxHash returning null for the same input.
    expect(classifySettlement(fail("settlement_pending_receipt"))).toBe("retry_broadcast");
    expect(classifySettlement(fail("settlement_pending_receipt:   "))).toBe("retry_broadcast");
  });

  it("settlement_failed → retry_broadcast", () => {
    expect(classifySettlement(fail("settlement_failed: RPC 503"))).toBe(
      "retry_broadcast",
    );
  });

  it("unrecognised errorReason → retry_broadcast (fail open)", () => {
    expect(classifySettlement(fail("some_future_error"))).toBe("retry_broadcast");
  });

  it("tampered_payload → definitive", () => {
    expect(classifySettlement(fail("tampered_payload"))).toBe("definitive");
  });

  it("transaction_reverted → definitive", () => {
    expect(classifySettlement(fail("transaction_reverted: 0xdead"))).toBe("definitive");
  });
});

describe("pendingReceiptTxHash", () => {
  it("extracts the txHash from a settlement_pending_receipt result", () => {
    expect(pendingReceiptTxHash(fail("settlement_pending_receipt: 0xabc123"))).toBe(
      "0xabc123",
    );
  });

  it("returns null for a non-pending failure", () => {
    expect(pendingReceiptTxHash(fail("settlement_failed: boom"))).toBeNull();
  });

  it("returns null for a success", () => {
    expect(pendingReceiptTxHash(ok)).toBeNull();
  });

  it("returns null when the prefix has no hash", () => {
    expect(pendingReceiptTxHash(fail("settlement_pending_receipt:   "))).toBeNull();
  });
});
