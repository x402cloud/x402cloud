import { describe, it, expect, vi } from "vitest";
import { settleUpto } from "../src/upto/settle.js";
import { X402_UPTO_PROXY } from "../src/constants.js";
import type { FacilitatorSigner, UptoPayload } from "../src/types.js";
import type { PaymentRequirements } from "@x402cloud/protocol";

const PAY_TO = "0x207C6D8f63Bf01F70dc6D372693E8D5943848E88" as const;
const PAYER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TX_HASH = "0xabc123def456" as `0x${string}`;
const FACILITATOR = "0x9999999999999999999999999999999999999999" as const;

function makeRequirements(overrides?: { amount?: string }): PaymentRequirements {
  return {
    scheme: "upto",
    network: "eip155:8453",
    asset: TOKEN,
    amount: overrides?.amount ?? "100000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { facilitator: FACILITATOR },
  };
}

function makePayload(overrides?: { authorized?: string }): UptoPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    signature: "0xdeadbeef",
    permit2Authorization: {
      from: PAYER,
      permitted: {
        token: TOKEN,
        amount: overrides?.authorized ?? "100000",
      },
      spender: X402_UPTO_PROXY,
      nonce: "12345",
      deadline: (now + 600).toString(),
      witness: {
        to: PAY_TO,
        facilitator: FACILITATOR,
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
  receiptThrows?: boolean;
}): FacilitatorSigner {
  return {
    readContract: vi.fn(async () => BigInt("1000000")),
    verifyTypedData: vi.fn(async () => overrides?.verifyTypedData ?? true),
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

describe("settleUpto", () => {
  // SECURITY: the quote is the ceiling, independent of the payer's budget.
  // An agent wallet authorizing $1.00 for a call quoted at $0.10 must not be
  // chargeable for $0.20 just because the budget covers it. `settleUpto` is
  // the LAST line — the resource server asking for this may be buggy or
  // compromised, and the facilitator is not obliged to believe it.
  it("rejects a settlement above the quoted price, even when the payer authorized more", async () => {
    const signer = makeSigner();
    const result = await settleUpto(
      signer,
      makePayload({ authorized: "1000000" }), // payer's wallet budget: $1.00
      makeRequirements({ amount: "100000" }), // the 402 quoted $0.10
      "200000", // …and the server asks for $0.20
    );

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("settlement_exceeds_quote");
    // Nothing was signed or broadcast.
    expect(signer.signSettlementTx).not.toHaveBeenCalled();
    expect(signer.sendRawSettlementTx).not.toHaveBeenCalled();
  });

  it("settles a metered amount below the quote", async () => {
    const result = await settleUpto(
      makeSigner(),
      makePayload({ authorized: "1000000" }),
      makeRequirements({ amount: "100000" }),
      "42000",
    );

    expect(result.success).toBe(true);
    expect(result.success && result.settledAmount).toBe("42000");
  });

  it("rejects if settlementAmount > authorized amount", async () => {
    const result = await settleUpto(
      makeSigner(),
      makePayload({ authorized: "100000" }),
      makeRequirements({ amount: "500000" }),
      "200000",
    );
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("settlement_exceeds_authorization");
  });

  it("returns success with zero settlement amount (no tx needed)", async () => {
    const signer = makeSigner();
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "0",
    );
    expect(result.success).toBe(true);
    expect(result.settledAmount).toBe("0");
    expect(signer.signSettlementTx).not.toHaveBeenCalled();
    expect(signer.sendRawSettlementTx).not.toHaveBeenCalled();
  });

  it("signs with the correct proxy address and args, then sends and confirms", async () => {
    const signer = makeSigner();
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "50000",
    );

    expect(result.success).toBe(true);
    expect(result.transaction).toBe(TX_HASH);
    expect(signer.signSettlementTx).toHaveBeenCalledWith(
      expect.objectContaining({
        address: X402_UPTO_PROXY,
        functionName: "settle",
      })
    );
    // The signed raw tx is what gets broadcast (not a re-encode).
    expect(signer.sendRawSettlementTx).toHaveBeenCalledWith(SERIALIZED);
  });

  it("handles reverted transaction", async () => {
    const signer = makeSigner({ receiptStatus: "reverted" });
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "50000",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toContain("transaction_reverted");
      expect(result.errorReason).toContain(TX_HASH);
    }
  });

  it("rejects tampered payload (bad signature)", async () => {
    const signer = makeSigner({ verifyTypedData: false });
    const result = await settleUpto(
      signer,
      makePayload(),
      makeRequirements(),
      "50000",
    );
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("tampered_payload");
    expect(signer.signSettlementTx).not.toHaveBeenCalled();
    expect(signer.sendRawSettlementTx).not.toHaveBeenCalled();
  });

  it("returns settlement_failed (TRANSIENT, no tx) when SIGNING throws", async () => {
    // Signing is pure local crypto, no network → a throw means NO tx exists →
    // nonce not consumed → safe to re-broadcast.
    const signer = makeSigner({ signThrows: true });
    const result = await settleUpto(signer, makePayload(), makeRequirements(), "50000");
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
    // THE new critical case: eth_sendRawTransaction may have landed the tx in
    // the mempool before its HTTP response was lost. We already hold the signed
    // hash, so a send-time throw must surface as pending-receipt (confirm the
    // known hash) — NOT settlement_failed (which would re-broadcast and revert).
    const signer = makeSigner({ sendThrows: true });
    const result = await settleUpto(signer, makePayload(), makeRequirements(), "50000");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe(`settlement_pending_receipt: ${TX_HASH}`);
    }
    expect(signer.signSettlementTx).toHaveBeenCalledTimes(1);
    expect(signer.sendRawSettlementTx).toHaveBeenCalledTimes(1);
    // Did NOT proceed to confirm — confirm happens via the durable retry path.
    expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("returns settlement_pending_receipt:<hash> when the tx broadcast but receipt-wait throws (NEVER re-broadcast)", async () => {
    // send succeeded → tx is mined, nonce consumed, USDC moved.
    // waitForTransactionReceipt throwing must NOT be misclassified as a failure.
    const signer = makeSigner({ receiptThrows: true });
    const result = await settleUpto(signer, makePayload(), makeRequirements(), "50000");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorReason).toBe(`settlement_pending_receipt: ${TX_HASH}`);
    }
    expect(signer.signSettlementTx).toHaveBeenCalledTimes(1);
    expect(signer.sendRawSettlementTx).toHaveBeenCalledTimes(1);
  });

  // ── Legacy fallback: a signer WITHOUT the two-step port (e.g. locally
  //    composed middleware signers) still settles via the one-shot writeContract.
  it("falls back to one-shot writeContract when no two-step port is present (legacy signer)", async () => {
    const writeContract = vi.fn(async () => TX_HASH);
    const signer = {
      readContract: vi.fn(async () => BigInt("1000000")),
      verifyTypedData: vi.fn(async () => true),
      writeContract,
      waitForTransactionReceipt: vi.fn(async () => ({
        status: "success" as const,
        transactionHash: TX_HASH,
      })),
    } as unknown as FacilitatorSigner;

    const result = await settleUpto(signer, makePayload(), makeRequirements(), "50000");

    expect(result.success).toBe(true);
    if (result.success) expect(result.transaction).toBe(TX_HASH);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: X402_UPTO_PROXY, functionName: "settle" }),
    );
  });
});
