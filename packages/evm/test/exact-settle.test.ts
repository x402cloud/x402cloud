import { describe, it, expect, vi } from "vitest";
import { settleExact } from "../src/exact/settle.js";
import { X402_EXACT_PROXY } from "../src/constants.js";
import type { FacilitatorSigner, ExactPayload } from "../src/types.js";
import type { PaymentRequirements } from "@x402cloud/protocol";

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88" as const;
const PAYER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TX_HASH = "0xabc123def456" as `0x${string}`;

function makeRequirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: TOKEN,
    amount: "100000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  };
}

function makePayload(): ExactPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    signature: "0xdeadbeef",
    permit2Authorization: {
      from: PAYER,
      permitted: {
        token: TOKEN,
        amount: "100000",
      },
      spender: X402_EXACT_PROXY,
      nonce: "12345",
      deadline: (now + 600).toString(),
      witness: {
        to: PAY_TO,
        validAfter: (now - 60).toString(),
      },
    },
  };
}

const SERIALIZED = "0xf86b..." as `0x${string}`;

function makeSigner(overrides?: {
  receiptStatus?: "success" | "reverted";
  verifyTypedData?: boolean;
  signThrows?: boolean;
  sendThrows?: boolean;
  verifyTypedDataThrows?: boolean;
  receiptThrows?: boolean;
}): FacilitatorSigner {
  return {
    readContract: vi.fn(async () => BigInt("1000000")),
    verifyTypedData: vi.fn(async () => {
      if (overrides?.verifyTypedDataThrows) throw new Error("verify boom");
      return overrides?.verifyTypedData ?? true;
    }),
    // Two-step settlement port (Finding 1): SIGN yields the deterministic hash
    // with NO network call; SEND broadcasts the raw tx.
    signSettlementTx: vi.fn(async () => {
      if (overrides?.signThrows) throw new Error("rpc boom");
      return { hash: TX_HASH, serialized: SERIALIZED };
    }),
    sendRawSettlementTx: vi.fn(async () => {
      if (overrides?.sendThrows) throw new Error("send dropped (response lost)");
    }),
    waitForTransactionReceipt: vi.fn(async () => {
      if (overrides?.receiptThrows) throw new Error("receipt timeout");
      return {
        status: overrides?.receiptStatus ?? ("success" as const),
        transactionHash: TX_HASH,
      };
    }),
  };
}

describe("settleExact", () => {
  it("signs with the exact proxy address, sends the raw tx, and confirms the full authorized amount", async () => {
    const signer = makeSigner();
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.transaction).toBe(TX_HASH);
      expect(result.settledAmount).toBe("100000");
      expect(result.network).toBe("eip155:8453");
    }
    expect(signer.signSettlementTx).toHaveBeenCalledWith(
      expect.objectContaining({
        address: X402_EXACT_PROXY,
        functionName: "settle",
      }),
    );
    expect(signer.sendRawSettlementTx).toHaveBeenCalledWith(SERIALIZED);
  });

  it("rejects tampered payload (bad signature)", async () => {
    const signer = makeSigner({ verifyTypedData: false });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe("tampered_payload");
    }
    expect(signer.signSettlementTx).not.toHaveBeenCalled();
    expect(signer.sendRawSettlementTx).not.toHaveBeenCalled();
  });

  it("returns signature_check_failed when verifyTypedData throws", async () => {
    const signer = makeSigner({ verifyTypedDataThrows: true });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe("signature_check_failed");
    }
    expect(signer.signSettlementTx).not.toHaveBeenCalled();
    expect(signer.sendRawSettlementTx).not.toHaveBeenCalled();
  });

  it("handles reverted transaction", async () => {
    const signer = makeSigner({ receiptStatus: "reverted" });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toContain("transaction_reverted");
      expect(result.errorReason).toContain(TX_HASH);
    }
  });

  it("returns settlement_failed (TRANSIENT, no tx) when SIGNING throws", async () => {
    // Signing is pure local crypto → a throw means NO tx exists → safe to retry.
    const signer = makeSigner({ signThrows: true });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toContain("settlement_failed");
      expect(result.errorReason).toContain("rpc boom");
    }
    // Never sent, never waited — there is no tx to confirm.
    expect(signer.sendRawSettlementTx).not.toHaveBeenCalled();
    expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("returns settlement_pending_receipt:<hash> when SEND throws AFTER a successful sign (Finding 1, NEVER re-broadcast)", async () => {
    // THE new critical case: the raw tx may be live in the mempool while the
    // send response was lost. We hold the signed hash, so surface pending-receipt
    // (confirm), NOT settlement_failed (which would re-broadcast and revert).
    const signer = makeSigner({ sendThrows: true });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe(`settlement_pending_receipt: ${TX_HASH}`);
    }
    expect(signer.signSettlementTx).toHaveBeenCalledTimes(1);
    expect(signer.sendRawSettlementTx).toHaveBeenCalledTimes(1);
    expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("returns settlement_pending_receipt:<hash> when the tx broadcast but receipt-wait throws (NEVER re-broadcast)", async () => {
    const signer = makeSigner({ receiptThrows: true });
    const result = await settleExact(signer, makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe(`settlement_pending_receipt: ${TX_HASH}`);
    }
    expect(signer.signSettlementTx).toHaveBeenCalledTimes(1);
    expect(signer.sendRawSettlementTx).toHaveBeenCalledTimes(1);
  });

  // SECURITY: exact transfers the full authorization, so settling one that is
  // bigger than the quote would charge the payer more than the 402 asked for.
  // Independent of `verifyExact` — a remote facilitator does not get to assume
  // its caller verified anything.
  it("refuses to settle an authorization larger than the quoted price", async () => {
    const signer = makeSigner();
    const requirements = { ...makeRequirements(), amount: "10000" };

    const result = await settleExact(signer, makePayload(), requirements);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe("authorization_not_exact");
    }
    expect(signer.signSettlementTx).not.toHaveBeenCalled();
  });
});
